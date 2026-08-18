import Foundation
import Network

final class FrameServer: @unchecked Sendable {
    static let port: NWEndpoint.Port = 59_727

    private let token: String
    private let queue = DispatchQueue(label: "com.beale.capture.transport", qos: .userInitiated)
    private var listener: NWListener?
    private var connection: NWConnection?
    private var pendingFrame: Data?
    private var isSending = false
    var onClientDisconnected: (() -> Void)?

    init(token: String) {
        self.token = token
    }

    func start() throws {
        guard !token.isEmpty else { throw FrameServerError.missingToken }
        let listener = try NWListener(using: .tcp, on: Self.port)
        listener.newConnectionHandler = { [weak self] connection in
            self?.authorize(connection, buffer: Data())
        }
        listener.stateUpdateHandler = { state in
            if case .failed(let error) = state {
                NSLog("Beale capture listener failed: %@", error.localizedDescription)
            }
        }
        self.listener = listener
        listener.start(queue: queue)
    }

    func stop() {
        queue.async { [weak self] in
            self?.connection?.cancel()
            self?.connection = nil
            self?.listener?.cancel()
            self?.listener = nil
            self?.pendingFrame = nil
            self?.isSending = false
        }
    }

    func send(jpeg: Data) {
        guard jpeg.count <= 8 * 1024 * 1024 else { return }
        queue.async { [weak self] in
            self?.pendingFrame = jpeg
            self?.flush()
        }
    }

    private func authorize(_ candidate: NWConnection, buffer: Data) {
        candidate.stateUpdateHandler = { state in
            if case .failed = state { candidate.cancel() }
        }
        candidate.start(queue: queue)
        receiveHandshake(candidate, buffer: buffer)
    }

    private func receiveHandshake(_ candidate: NWConnection, buffer: Data) {
        candidate.receive(minimumIncompleteLength: 1, maximumLength: 512) { [weak self, candidate] data, _, complete, error in
            guard let self else { return }
            if error != nil || complete {
                candidate.cancel()
                return
            }
            var next = buffer
            if let data { next.append(data) }
            guard next.count <= 512 else {
                candidate.cancel()
                return
            }
            guard let newline = next.firstIndex(of: 0x0a) else {
                self.receiveHandshake(candidate, buffer: next)
                return
            }
            let line = String(decoding: next[..<newline], as: UTF8.self)
            guard line == "BEALE/1 \(self.token)" else {
                candidate.cancel()
                return
            }

            self.connection?.cancel()
            self.connection = candidate
            candidate.stateUpdateHandler = { [weak self, weak candidate] state in
                guard let self, let candidate else { return }
                if case .failed = state { self.remove(candidate) }
                if case .cancelled = state { self.remove(candidate) }
            }
            candidate.send(content: Data("BEALE/1 OK\n".utf8), completion: .contentProcessed { [weak self] error in
                if error != nil { candidate.cancel() }
                self?.flush()
            })
        }
    }

    private func remove(_ candidate: NWConnection) {
        guard connection === candidate else { return }
        connection = nil
        isSending = false
        DispatchQueue.main.async { [weak self] in
            self?.onClientDisconnected?()
        }
    }

    private func flush() {
        guard !isSending, let connection, let frame = pendingFrame else { return }
        pendingFrame = nil
        isSending = true

        var length = UInt32(frame.count).bigEndian
        var packet = withUnsafeBytes(of: &length) { Data($0) }
        packet.append(frame)
        connection.send(content: packet, completion: .contentProcessed { [weak self, weak connection] error in
            guard let self else { return }
            self.isSending = false
            if error != nil, let connection {
                self.remove(connection)
                connection.cancel()
                return
            }
            self.flush()
        })
    }
}

private enum FrameServerError: LocalizedError {
    case missingToken

    var errorDescription: String? {
        "Beale did not provide a USB session token."
    }
}
