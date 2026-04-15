import Foundation
import CryptoKit

/// Streaming SHA256 hasher for files on disk.
///
/// Used for deduplication and integrity checks. Streams the file in fixed-size
/// chunks so hashing a 25 MB attachment doesn't spike memory. Safe to call from
/// any actor — this has no shared state.
enum FileHasher {
    /// Default read chunk when streaming large files. 256 KB keeps peak
    /// memory low while still amortising FileHandle syscall overhead.
    static let chunkSize = 256 * 1024

    /// Compute the SHA256 hex-digest of the file at `url`. Throws on I/O
    /// failures. Returns a lowercase hex string (64 chars).
    static func sha256Hex(of url: URL) throws -> String {
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }

        var hasher = SHA256()
        while autoreleasepool(invoking: { () -> Bool in
            let chunk = handle.readData(ofLength: chunkSize)
            guard !chunk.isEmpty else { return false }
            hasher.update(data: chunk)
            return true
        }) {}

        let digest = hasher.finalize()
        return digest.map { String(format: "%02x", $0) }.joined()
    }

    /// Hash raw data — useful for small in-memory blobs. Prefer `sha256Hex(of:)`
    /// for on-disk files to avoid loading the full byte buffer.
    static func sha256Hex(of data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
