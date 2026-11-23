package com.emd.androidfixture

import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId

class MainActivity : ComponentActivity() {
    @OptIn(ExperimentalComposeUiApi::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme {
                var label by remember { mutableStateOf("Ready") }
                // Test tags show as resource IDs, so uiautomator and Maestro find them.
                Column(
                    modifier = Modifier.fillMaxSize().semantics { testTagsAsResourceId = true },
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(label, modifier = Modifier.testTag("smoke-label"))
                    Button(
                        onClick = {
                            Log.i("EMD", "[EMD:smoke] tapped")
                            label = "Tapped"
                        },
                        modifier = Modifier.testTag("smoke-button"),
                    ) {
                        Text("Tap me")
                    }
                }
            }
        }
    }
}
