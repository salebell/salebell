import Foundation

/// Postgres values arrive as JSON from PostgREST and Realtime, which differ in small ways
/// (numeric may be a number or a string, timestamps may use a space and 6 fractional digits).
enum PostgresValue {
    static func date(from string: String) -> Date? {
        var s = string.replacingOccurrences(of: " ", with: "T")
        // "+00" → "+00:00"
        if let r = s.range(of: #"[+-]\d{2}$"#, options: .regularExpression) {
            s.replaceSubrange(r, with: s[r] + ":00")
        }
        // Trim fractional seconds to milliseconds.
        if let r = s.range(of: #"\.\d+"#, options: .regularExpression) {
            let digits = s[r].dropFirst().prefix(3)
            s.replaceSubrange(r, with: "." + digits.padding(toLength: 3, withPad: "0", startingAt: 0))
        }
        if !s.contains(where: { $0 == "Z" || $0 == "+" }) && s.range(of: #"T.*-"#, options: .regularExpression) == nil {
            s += "Z"
        }
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: s) { return d }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: s)
    }
}

extension KeyedDecodingContainer {
    func lossyDouble(_ key: Key) -> Double {
        if let v = try? decodeIfPresent(Double.self, forKey: key) { return v }
        if let s = try? decodeIfPresent(String.self, forKey: key), let v = Double(s) { return v }
        return 0
    }

    func optionalDouble(_ key: Key) -> Double? {
        if let v = try? decodeIfPresent(Double.self, forKey: key) { return v }
        if let s = try? decodeIfPresent(String.self, forKey: key) { return Double(s) }
        return nil
    }

    func lossyInt(_ key: Key) -> Int {
        Int(lossyDouble(key).rounded())
    }

    func optionalDate(_ key: Key) -> Date? {
        guard let s = try? decodeIfPresent(String.self, forKey: key) else { return nil }
        return PostgresValue.date(from: s)
    }

    func requiredDate(_ key: Key) throws -> Date {
        let s = try decode(String.self, forKey: key)
        guard let d = PostgresValue.date(from: s) else {
            throw DecodingError.dataCorruptedError(forKey: key, in: self, debugDescription: "Bad timestamp \(s)")
        }
        return d
    }
}
