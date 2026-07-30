import AppKit
import Foundation
import PDFKit
import Vision

struct OcrFailure: Error {
    let message: String
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("\(message)\n".utf8))
    exit(1)
}

guard CommandLine.arguments.count == 2 else {
    fail("usage: macos-vision-pdf-ocr.swift <pdf-path>")
}

let inputPath = CommandLine.arguments[1]
let inputUrl = URL(fileURLWithPath: inputPath)
guard inputUrl.pathExtension.lowercased() == "pdf" else {
    fail("input must be a PDF")
}
guard let document = PDFDocument(url: inputUrl), document.pageCount > 0 else {
    fail("PDF could not be opened")
}
guard document.pageCount <= 300 else {
    fail("PDF exceeds the 300-page OCR limit")
}

var pages: [[String: Any]] = []
for pageOffset in 0..<document.pageCount {
    guard let page = document.page(at: pageOffset) else {
        fail("PDF page \(pageOffset + 1) could not be read")
    }
    let bounds = page.bounds(for: .mediaBox)
    let longestEdge = max(bounds.width, bounds.height)
    let scale = min(3.0, max(1.5, 2400.0 / max(longestEdge, 1.0)))
    let target = NSSize(
        width: max(1.0, bounds.width * scale),
        height: max(1.0, bounds.height * scale)
    )
    let image = page.thumbnail(of: target, for: .mediaBox)
    var proposedRect = NSRect(origin: .zero, size: image.size)
    guard let cgImage = image.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil) else {
        fail("PDF page \(pageOffset + 1) could not be rendered")
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = true
    request.minimumTextHeight = 0.006

    do {
        try VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
            .perform([request])
    } catch {
        fail("OCR failed on page \(pageOffset + 1): \(error.localizedDescription)")
    }

    let observations = (request.results ?? []).sorted { left, right in
        let rowDelta = left.boundingBox.midY - right.boundingBox.midY
        if abs(rowDelta) > 0.01 { return rowDelta > 0 }
        return left.boundingBox.minX < right.boundingBox.minX
    }
    var lines: [String] = []
    var confidences: [Float] = []
    var evidence: [[String: Any]] = []
    for observation in observations {
        guard let candidate = observation.topCandidates(1).first else { continue }
        let value = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { continue }
        lines.append(value)
        confidences.append(candidate.confidence)
        evidence.append([
            "text": value,
            "confidence": Double(candidate.confidence),
            "box": [
                "x": observation.boundingBox.minX,
                "y": observation.boundingBox.minY,
                "width": observation.boundingBox.width,
                "height": observation.boundingBox.height,
            ],
        ])
    }
    let confidence = confidences.isEmpty
        ? 0.0
        : Double(confidences.reduce(0, +) / Float(confidences.count))
    pages.append([
        "index": pageOffset + 1,
        "text": lines.joined(separator: "\n"),
        "confidence": confidence,
        "evidence": evidence,
    ])
}

let result: [String: Any] = [
    "providerId": "macos-vision",
    "providerVersion": ProcessInfo.processInfo.operatingSystemVersionString,
    "pageCount": document.pageCount,
    "pages": pages,
]

do {
    let data = try JSONSerialization.data(withJSONObject: result, options: [])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
    fail("OCR result could not be serialized")
}
