import CoreImage
import CoreMedia
import Foundation
import ImageIO
import ScreenCaptureKit
import UniformTypeIdentifiers

final class CaptureCoordinator: NSObject, ObservableObject {
    @Published private(set) var status = "Waiting for Beale over USB…"
    @Published private(set) var isCapturing = false
    @Published private(set) var isReady = false

    private let frameQueue = DispatchQueue(label: "com.beale.capture.frames", qos: .userInitiated)
    private let imageContext = CIContext(options: [.cacheIntermediates: false])
    private let colorSpace = CGColorSpace(name: CGColorSpace.sRGB)!
    private let server: FrameServer
    private var stream: SCStream?
    private var lastFrameTime: CFTimeInterval = 0

    override init() {
        let token = ProcessInfo.processInfo.environment["BEALE_CAPTURE_TOKEN"] ?? ""
        server = FrameServer(token: token)
        super.init()
        server.onClientDisconnected = { [weak self] in
            self?.stop()
        }

        let picker = SCContentSharingPicker.shared
        picker.add(self)
        picker.isActive = true
        var configuration = SCContentSharingPickerConfiguration()
        configuration.showsMicrophoneControl = false
        configuration.showsCameraControl = false
        picker.defaultConfiguration = configuration

        guard !token.isEmpty else {
            status = "Open this companion from Beale on the connected Mac."
            return
        }
        guard picker.isAvailable else {
            status = "Screen capture is unavailable on this iPhone."
            return
        }

        do {
            try server.start()
            isReady = true
            status = "Connected over USB. Ready to share."
        } catch {
            status = "USB transport failed: \(error.localizedDescription)"
        }
    }

    deinit {
        SCContentSharingPicker.shared.remove(self)
        server.stop()
    }

    func presentPicker() {
        guard isReady else { return }
        status = "Choose Entire Screen in the system picker."
        SCContentSharingPicker.shared.present(using: .display)
    }

    func stop() {
        guard let stream else { return }
        self.stream = nil
        Task {
            try? await stream.stopCapture()
            updateState(capturing: false, status: "Capture stopped. Ready to share again.")
        }
    }

    private func start(filter: SCContentFilter) {
        let configuration = SCStreamConfiguration()
        configuration.width = min(1290, max(1, Int(filter.contentRect.width * CGFloat(filter.pointPixelScale))))
        configuration.height = min(2796, max(1, Int(filter.contentRect.height * CGFloat(filter.pointPixelScale))))
        configuration.capturesAudio = false

        let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
        do {
            try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: frameQueue)
        } catch {
            updateState(capturing: false, status: "Could not configure capture: \(error.localizedDescription)")
            return
        }
        self.stream = stream
        Task {
            do {
                try await stream.startCapture()
                updateState(capturing: true, status: "Sharing the iPhone screen with Beale.")
            } catch {
                self.stream = nil
                updateState(capturing: false, status: "Capture failed: \(error.localizedDescription)")
            }
        }
    }

    private func updateState(capturing: Bool, status: String) {
        DispatchQueue.main.async { [weak self] in
            self?.isCapturing = capturing
            self?.status = status
        }
    }
}

extension CaptureCoordinator: SCContentSharingPickerObserver {
    func contentSharingPicker(
        _ picker: SCContentSharingPicker,
        didUpdateWith filter: SCContentFilter,
        for stream: SCStream?
    ) {
        if let stream {
            self.stream = stream
            return
        }
        start(filter: filter)
    }

    func contentSharingPicker(_ picker: SCContentSharingPicker, didCancelFor stream: SCStream?) {
        updateState(capturing: false, status: "Screen sharing was canceled.")
    }

    func contentSharingPickerStartDidFailWithError(_ error: Error) {
        updateState(capturing: false, status: "Picker failed: \(error.localizedDescription)")
    }
}

extension CaptureCoordinator: SCStreamOutput, SCStreamDelegate {
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen,
              sampleBuffer.isValid,
              let pixelBuffer = sampleBuffer.imageBuffer else { return }

        let now = CACurrentMediaTime()
        guard now - lastFrameTime >= 1.0 / 12.0 else { return }
        lastFrameTime = now

        let image = CIImage(cvPixelBuffer: pixelBuffer)
        guard let rendered = imageContext.createCGImage(image, from: image.extent, format: .RGBA8, colorSpace: colorSpace) else { return }
        let jpeg = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(jpeg, UTType.jpeg.identifier as CFString, 1, nil) else { return }
        CGImageDestinationAddImage(
            destination,
            rendered,
            [kCGImageDestinationLossyCompressionQuality: 0.68] as CFDictionary
        )
        guard CGImageDestinationFinalize(destination) else { return }
        server.send(jpeg: jpeg as Data)
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        self.stream = nil
        updateState(capturing: false, status: "Capture ended: \(error.localizedDescription)")
    }
}
