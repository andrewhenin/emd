import SwiftUI

struct ContentView: View {
    @State private var label = "Ready"

    var body: some View {
        VStack(spacing: 16) {
            Text(label)
                .accessibilityIdentifier("smoke-label")
            Button("Tap me") {
                NSLog("[EMD:smoke] tapped")
                label = "Tapped"
            }
            .accessibilityIdentifier("smoke-button")
        }
    }
}
