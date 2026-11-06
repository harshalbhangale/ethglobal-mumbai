/*
 * Kallr addition to FlorisBoard (Apache-2.0).
 *
 * The user's Kallr wallet: the same Privy embedded wallet as the Kallr web desk, signed in with X.
 * Keys never leave Privy; the keyboard only asks it for signatures on Flash orders the user
 * confirms in KallrTradeActivity.
 */

package dev.patrickgold.florisboard.ime.kallr

import android.content.Context
import dev.patrickgold.florisboard.BuildConfig
import io.privy.auth.AuthState
import io.privy.auth.PrivyUser
import io.privy.auth.oAuth.OAuthProvider
import io.privy.logging.PrivyLogLevel
import io.privy.sdk.Privy
import io.privy.sdk.PrivyConfig
import io.privy.wallet.ethereum.EmbeddedEthereumWallet
import io.privy.wallet.ethereum.EthereumChain
import io.privy.wallet.ethereum.EthereumRpcRequest
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.net.HttpURLConnection
import java.net.URL

object KallrWallet {
    /** Redirect scheme for Privy's X login; register it on the Android client in the Privy dashboard. */
    const val URL_SCHEME = "kallr"
    private const val BASE_CHAIN_ID_HEX = "0x2105"
    private const val BASE_RPC = "https://mainnet.base.org"
    private const val PREFS = "kallr-wallet"

    val configured: Boolean get() = BuildConfig.PRIVY_APP_ID.isNotBlank() && BuildConfig.PRIVY_CLIENT_ID.isNotBlank()

    private var privy: Privy? = null

    /** The signed-in wallet's address, cached so the keyboard header can show it instantly. */
    private val _address = MutableStateFlow<String?>(null)
    val address = _address.asStateFlow()

    /** Call once from Application.onCreate, on the main thread (Privy's requirement). */
    fun init(context: Context) {
        val app = context.applicationContext
        _address.value = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("address", null)
        if (!configured || privy != null) return
        privy = runCatching {
            Privy.init(
                context = app,
                config = PrivyConfig(
                    appId = BuildConfig.PRIVY_APP_ID,
                    appClientId = BuildConfig.PRIVY_CLIENT_ID,
                    logLevel = if (BuildConfig.DEBUG) PrivyLogLevel.VERBOSE else PrivyLogLevel.NONE,
                ),
            )
        }.getOrNull()
    }

    private fun requirePrivy(): Privy =
        privy ?: error("Privy isn't set up in this build. Rebuild with -PprivyAppId and -PprivyClientId.")

    suspend fun user(): PrivyUser? {
        val p = privy ?: return null
        return when (p.getAuthState()) {
            is AuthState.Authenticated, is AuthState.AuthenticatedUnverified -> p.getUser()
            else -> null
        }
    }

    /** Sign in with X (same Privy login as the web desk), then make sure there's an embedded wallet. */
    suspend fun signInWithX(context: Context): Result<String> = runCatching {
        val user = requirePrivy().oAuth.login(OAuthProvider.Twitter, URL_SCHEME).getOrThrow()
        val wallet = walletOf(user)
        remember(context, wallet.address)
        wallet.address
    }

    suspend fun signOut(context: Context) {
        privy?.logout()
        remember(context, null)
    }

    /** The user's embedded Ethereum wallet, created on first use, switched to Base. */
    suspend fun wallet(context: Context): EmbeddedEthereumWallet {
        val user = user() ?: error("Sign in to Kall Markets first.")
        return walletOf(user).also { remember(context, it.address) }
    }

    private suspend fun walletOf(user: PrivyUser): EmbeddedEthereumWallet {
        val wallet = user.embeddedEthereumWallets.firstOrNull() ?: user.createEthereumWallet(allowAdditional = false).getOrThrow()
        wallet.provider.switchChain(EthereumChain.Base)
        return wallet
    }

    private fun remember(context: Context, address: String?) {
        _address.value = address
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("address", address).apply()
    }

    suspend fun signTypedData(wallet: EmbeddedEthereumWallet, typedDataJson: String): String =
        wallet.provider.request(EthereumRpcRequest.ethSignTypedDataV4(wallet.address, typedDataJson)).getOrThrow().data

    /** Sends a transaction on Base and waits until it's mined successfully. */
    suspend fun sendAndWait(wallet: EmbeddedEthereumWallet, to: String, data: String, valueWei: String? = null): String {
        val tx = buildJsonObject {
            put("from", wallet.address)
            put("to", to)
            put("data", data)
            put("chainId", BASE_CHAIN_ID_HEX)
            if (valueWei != null) put("value", "0x" + java.math.BigInteger(valueWei).toString(16))
        }
        val hash = wallet.provider.request(EthereumRpcRequest.ethSendTransaction(tx.toString())).getOrThrow().data
        repeat(60) {
            delay(2_000)
            val receipt = rpc("eth_getTransactionReceipt", "[\"$hash\"]")
            if (receipt is JsonObject) {
                val status = receipt["status"]?.jsonPrimitive?.content
                if (status == "0x1") return hash
                error("The transaction failed on Base.")
            }
        }
        error("Base didn't confirm the transaction in 2 minutes.")
    }

    private suspend fun rpc(method: String, params: String) = withContext(Dispatchers.IO) {
        val connection = (URL(BASE_RPC).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            doOutput = true
            connectTimeout = 8_000
            readTimeout = 15_000
            setRequestProperty("content-type", "application/json")
        }
        try {
            connection.outputStream.use { it.write("""{"jsonrpc":"2.0","id":1,"method":"$method","params":$params}""".toByteArray()) }
            val body = connection.inputStream.bufferedReader().use { it.readText() }
            Json.parseToJsonElement(body).jsonObject["result"]?.takeUnless { it is JsonPrimitive && it.content == "null" }
        } catch (e: Exception) {
            null
        } finally {
            connection.disconnect()
        }
    }
}
