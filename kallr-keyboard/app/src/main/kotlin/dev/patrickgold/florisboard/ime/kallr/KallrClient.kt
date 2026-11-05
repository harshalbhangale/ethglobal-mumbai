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

@Serializable
data class AmResponse(
    val post: AmPost? = null,
    val call: AmCall? = null,
    val record: AmRecord? = null,
    val token: AmToken? = null,
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
    private val ORDER_HAS_SIZE = Regex("""\$\s*\d|\bmy\s+\$?[a-z]""", RegexOption.IGNORE_CASE)

    /** The only part of the clipboard we send: an X post link or a contract address. */
    fun clipboardReference(clip: String?): String? {
        if (clip.isNullOrBlank()) return null
        return POST_LINK.find(clip)?.value ?: EVM_ADDRESS.find(clip)?.value
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
