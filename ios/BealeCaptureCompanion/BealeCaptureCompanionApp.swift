import SwiftUI

@main
struct BealeCaptureCompanionApp: App {
    @StateObject private var capture = CaptureCoordinator()

    var body: some Scene {
        WindowGroup {
            ContentView(capture: capture)
        }
    }
}

private struct ContentView: View {
    @ObservedObject var capture: CaptureCoordinator

    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color(red: 0.04, green: 0.05, blue: 0.08), .black],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            VStack(spacing: 22) {
                Image(systemName: capture.isCapturing ? "iphone.radiowaves.left.and.right" : "iphone.and.arrow.forward")
                    .font(.system(size: 52, weight: .light))
                    .foregroundStyle(capture.isCapturing ? .green : .white)

                VStack(spacing: 8) {
                    Text("Beale Capture")
                        .font(.title.bold())
                    Text(capture.status)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

                Button(capture.isCapturing ? "Stop Capture" : "Share iPhone Screen") {
                    if capture.isCapturing {
                        capture.stop()
                    } else {
                        capture.presentPicker()
                    }
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .disabled(!capture.isReady)

                Text("Frames are sent only to the USB-connected Beale host and are not stored by this companion.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 28)
            }
            .foregroundStyle(.white)
            .padding(24)
        }
    }
}
