/*
 * Kallr addition to FlorisBoard (Apache-2.0).
 *
 * Hold-to-talk orders: records a short AAC clip while the mic is held, then sends it to the Kallr
 * server (ElevenLabs Scribe for the words, the AI layer for the order). Nothing is recorded unless
 * the user holds the mic, and the clip is deleted after it's sent.
 */

package dev.patrickgold.florisboard.ime.kallr

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.MediaRecorder
import android.os.Build
import android.os.Bundle
import java.io.File

object KallrVoice {
    private var recorder: MediaRecorder? = null
    private var file: File? = null

    fun hasPermission(context: Context) =
        context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    /** Starts recording; false if the mic isn't allowed yet (the permission screen opens). */
    fun start(context: Context): Boolean {
        if (!hasPermission(context)) {
            KallrPanelState.resumeOn(Tab.Swap)
            context.startActivity(Intent(context, KallrMicPermissionActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            return false
        }
        stopQuietly()
        val out = File(context.cacheDir, "kallr-voice.m4a")
        val r = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(context) else @Suppress("DEPRECATION") MediaRecorder()
        return runCatching {
            r.setAudioSource(MediaRecorder.AudioSource.MIC)
            r.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            r.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            r.setAudioSamplingRate(16_000)
            r.setAudioEncodingBitRate(64_000)
            r.setOutputFile(out.absolutePath)
            r.prepare()
            r.start()
            recorder = r
            file = out
            true
        }.getOrElse {
            r.release()
            false
        }
    }

    /** Stops and returns the clip's bytes (null if nothing usable was recorded). */
    fun stop(): ByteArray? {
        val r = recorder ?: return null
        recorder = null
        val ok = runCatching { r.stop() }.isSuccess
        r.release()
        val f = file
        file = null
        val bytes = if (ok) f?.takeIf { it.length() > 500 }?.readBytes() else null
        f?.delete()
        return bytes
    }

    private fun stopQuietly() {
        recorder?.let { runCatching { it.stop() }; it.release() }
        recorder = null
        file?.delete()
        file = null
    }
}

/** Asks for the microphone once (a keyboard can't show the prompt itself), then closes. */
class KallrMicPermissionActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (KallrVoice.hasPermission(this)) finish() else requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        finish()
    }
}
