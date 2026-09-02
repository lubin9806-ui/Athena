package com.elanastra.athena

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.tts.TextToSpeech
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.darkColorScheme
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import com.elanastra.athena.ui.AthenaCompanionApp
import java.util.Locale

class MainActivity : ComponentActivity() {
    private var textToSpeech: TextToSpeech? = null
    private val microphone = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        textToSpeech = TextToSpeech(this) { status ->
            if (status == TextToSpeech.SUCCESS) textToSpeech?.language = Locale.SIMPLIFIED_CHINESE
        }
        setContent {
            val model: CompanionViewModel = viewModel()
            MaterialTheme(colorScheme = darkColorScheme(primary = Color(0xFFC8D9CF), background = Color(0xFF121714))) {
                Surface(modifier = Modifier.fillMaxSize()) {
                    AthenaCompanionApp(
                        model = model,
                        onRequestMic = { requestMic() },
                        onSpeak = { text -> textToSpeech?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "athena") },
                    )
                }
            }
        }
    }

    private fun requestMic() {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            microphone.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    override fun onDestroy() {
        textToSpeech?.shutdown()
        super.onDestroy()
    }
}
