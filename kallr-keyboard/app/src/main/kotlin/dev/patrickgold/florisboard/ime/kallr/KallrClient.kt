/*
 * Kallr addition to FlorisBoard (Apache-2.0).
 *
 * Talks to the Kallr web app's /api/keyboard route. Read-only: the keyboard never
 * holds keys and never signs. An order comes back as a desk link the user opens and signs.
 *
 * Privacy: only an X post link, a contract address, or the order phrase being typed is
 * ever sent. Nothing else from the clipboard or the text field leaves the phone.
 */

package dev.patrickgold.florisboard.ime.kallr

import android.content.Context
import dev.patrickgold.florisboard.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.net.HttpURLConnection
import java.net.URL

@Serializable
data class AmPost(val postId: String, val handle: String, val text: String)

@Serializable
data class AmCall(val line: String, val status: String, val asset: String, val direction: String)

@Serializable
data class AmRecord(val line: String, val coverage: String)

@Serializable
data class AmToken(val address: String, val symbol: String? = null, val warnings: List<String> = emptyList(), val line: String)

@Serializable
data class AmOrder(
    val ok: Boolean,
    val text: String? = null,
    val summary: String? = null,
    val tradable: Boolean = false,
    val deskUrl: String? = null,
    val error: String? = null,
)

/** What the trade panel can buy for this call: ETH, BTC or a Base token contract. */
@Serializable
data class AmTrade(val token: String, val symbol: String, val price: Double, val logo: String? = null)

/** The AI's one-line read of a message. */
@Serializable
data class AmAi(val summary: String, val symbol: String? = null, val direction: String? = null, val timeframe: String? = null)

/** A shared contract that claims a ticker but isn't the real token with it on Base. */
@Serializable
data class AmFake(val claimed: String, val contract: String, val real: String)

/** An order the message, typed words or voice asked for. */
@Serializable
data class AmPrefill(
    val kind: String? = null,
    val usd: Double? = null,
    val limitPct: Double? = null,
    val twapMinutes: Int? = null,
    val tpPct: Double? = null,
    val slPct: Double? = null,
)

@Serializable
data class VoiceResult(val transcript: String, val summary: String, val prefill: AmPrefill? = null, val trade: AmTrade? = null)

@Serializable
data class AmResponse(
    val post: AmPost? = null,
    val call: AmCall? = null,
    val record: AmRecord? = null,
    val token: AmToken? = null,
    val trade: AmTrade? = null,
    val ai: AmAi? = null,
    val fake: AmFake? = null,
    val prefill: AmPrefill? = null,
    val order: AmOrder? = null,
) {
    val isEmpty get() = post == null && call == null && token == null && order == null
}

@Serializable
private data class AmRequest(val text: String? = null, val typed: String? = null, val history: List<AmPost> = emptyList())

object Kallr {
    /** Set at build time with -PkallrOrigin=https://…; defaults to the dev server via `adb reverse tcp:3000 tcp:3000`. */
    val origin: String = BuildConfig.KALLR_ORIGIN.trimEnd('/')

    private val json = Json { ignoreUnknownKeys = true; explicitNulls = false }

    private val POST_LINK = Regex("""https://(?:www\.)?(?:x|twitter)\.com/[A-Za-z0-9_]{1,15}/status/[0-9]{1,20}""")
    private val EVM_ADDRESS = Regex("""(?<![A-Za-z0-9])0x[0-9a-fA-F]{40}(?![A-Za-z0-9])""")
    private val ORDER_START = Regex("""\b(copy|buy|long|sell|short)\b""", RegexOption.IGNORE_CASE)
    private val ORDER_HAS_SIZE = Regex("""\$\s*\d|\bmy\s+\$?[a-z]|\d+\s*(?:bucks|usd|dollars?)\b""", RegexOption.IGNORE_CASE)
    private val CASHTAG = Regex("""(?<![A-Za-z0-9$])\$[A-Za-z][A-Za-z0-9]{1,9}\b""")

    /**
     * What we send from the clipboard or a selection: an X post link, or a message that names a coin
     * (a $CASHTAG or a contract), e.g. a Telegram call. Anything else stays on the phone.
     */
    fun clipboardReference(clip: String?): String? {
        if (clip.isNullOrBlank()) return null
        POST_LINK.find(clip)?.let { return it.value }
        if (CASHTAG.containsMatchIn(clip) || EVM_ADDRESS.containsMatchIn(clip)) return clip.trim().take(600)
        return null
    }

    /** The order phrase at the end of the line being typed, e.g. "copy $5 tp 10% sl 5%". Mirrors kallr-webapp/lib/keyboard.ts. */
    fun typedOrder(textBeforeCursor: String): String? {
        val line = textBeforeCursor.substringAfterLast('\n')
        val start = ORDER_START.findAll(line).lastOrNull() ?: return null
        val candidate = line.substring(start.range.first).trim()
        return if (ORDER_HAS_SIZE.containsMatchIn(candidate)) candidate.take(200) else null
    }

    suspend fun lookup(context: Context, reference: String?, typed: String?): AmResponse? = withContext(Dispatchers.IO) {
        if (reference == null && typed == null) return@withContext null
        val body = json.encodeToString(AmRequest(text = reference, typed = typed, history = History.load(context)))
        val connection = (URL("$origin/api/keyboard").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 5_000
            readTimeout = 15_000
            doOutput = true
            setRequestProperty("content-type", "application/json")
        }
        try {
            connection.outputStream.use { it.write(body.toByteArray()) }
            if (connection.responseCode !in 200..299) return@withContext null
            val text = connection.inputStream.bufferedReader().use { it.readText() }
            json.decodeFromString<AmResponse>(text).also { r -> r.post?.let { History.add(context, it) } }
        } catch (e: Exception) {
            null
        } finally {
            connection.disconnect()
        }
    }

    /** POST JSON to the Kallr web app; the body text on 2xx, or a Kallr error message. */
    suspend fun post(path: String, body: String): Result<String> = request("POST", path, body)

    suspend fun get(path: String): Result<String> = request("GET", path, null)

    /** A spoken order: audio in, the words and the order the AI heard out. */
    suspend fun voice(audio: ByteArray): Result<VoiceResult> = withContext(Dispatchers.IO) {
        val connection = (URL("$origin/api/keyboard/voice").openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 8_000
            readTimeout = 40_000
            doOutput = true
            setRequestProperty("content-type", "audio/mp4")
        }
        try {
            connection.outputStream.use { it.write(audio) }
            val ok = connection.responseCode in 200..299
            val text = (if (ok) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            if (ok) Result.success(json.decodeFromString<VoiceResult>(text))
            else Result.failure(Exception(runCatching {
                (json.parseToJsonElement(text) as kotlinx.serialization.json.JsonObject)["error"]?.toString()?.trim('"')
            }.getOrNull() ?: "Voice failed (${connection.responseCode})"))
        } catch (e: Exception) {
            Result.failure(Exception("Couldn't reach Kall Markets at $origin"))
        } finally {
            connection.disconnect()
        }
    }

    private suspend fun request(method: String, path: String, body: String?): Result<String> = withContext(Dispatchers.IO) {
        val connection = (URL("$origin$path").openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 8_000
            readTimeout = 30_000
            if (body != null) {
                doOutput = true
                setRequestProperty("content-type", "application/json")
            }
        }
        try {
            if (body != null) connection.outputStream.use { it.write(body.toByteArray()) }
            val ok = connection.responseCode in 200..299
            val text = (if (ok) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
            if (ok) Result.success(text)
            else Result.failure(Exception(runCatching {
                json.parseToJsonElement(text).let { (it as kotlinx.serialization.json.JsonObject)["error"]?.toString()?.trim('"') }
            }.getOrNull() ?: "Kall Markets server error (${connection.responseCode})"))
        } catch (e: Exception) {
            Result.failure(Exception("Couldn't reach Kall Markets at $origin"))
        } finally {
            connection.disconnect()
        }
    }

    /** Posts looked up on this keyboard, so the caller's record grows like the extension's. */
    private object History {
        private const val PREFS = "kallr"
        private const val KEY = "history"
        private const val MAX = 40

        fun load(context: Context): List<AmPost> {
            val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return emptyList()
            return runCatching { json.decodeFromString<List<AmPost>>(raw) }.getOrDefault(emptyList())
        }

        fun add(context: Context, post: AmPost) {
            val next = (listOf(post) + load(context).filter { it.postId != post.postId }).take(MAX)
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString(KEY, json.encodeToString(next))
                .apply()
        }
    }
}
