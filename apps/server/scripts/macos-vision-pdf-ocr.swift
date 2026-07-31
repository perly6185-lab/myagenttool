import AppKit
import Foundation
import ImageIO
import PDFKit
import Vision

private let maximumPages = 300
private let maximumImageDimension = 20_000
private let maximumImagePixels = 50_000_000
private let imageExtensions = Set(["png", "jpg", "jpeg", "webp"])

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("\(message)\n".utf8))
    exit(1)
}

func progress(_ completed: Int, _ total: Int) {
    FileHandle.standardError.write(
        Data("MYAGENTTOOL_OCR_PROGRESS \(completed)/\(total)\n".utf8)
    )
}

func recognize(
    _ cgImage: CGImage,
    index: Int,
    orientation: CGImagePropertyOrientation = .up
) -> [String: Any] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.recognitionLanguages = ["zh-Hans", "en-US"]
    request.usesLanguageCorrection = true
    request.minimumTextHeight = 0.006

    do {
        try VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:])
            .perform([request])
    } catch {
        fail("OCR failed on item \(index): \(error.localizedDescription)")
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
    return [
        "index": index,
        "text": lines.joined(separator: "\n"),
        "confidence": confidence,
        "width": cgImage.width,
        "height": cgImage.height,
        "evidence": evidence,
    ]
}

func pdfPages(_ inputUrl: URL) -> [[String: Any]] {
    guard let document = PDFDocument(url: inputUrl), document.pageCount > 0 else {
        fail("PDF could not be opened")
    }
    guard document.pageCount <= maximumPages else {
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
        guard let cgImage = image.cgImage(
            forProposedRect: &proposedRect,
            context: nil,
            hints: nil
        ) else {
            fail("PDF page \(pageOffset + 1) could not be rendered")
        }
        pages.append(recognize(cgImage, index: pageOffset + 1))
        progress(pageOffset + 1, document.pageCount)
    }
    return pages
}

func imagePage(_ inputUrl: URL) -> [[String: Any]] {
    guard let source = CGImageSourceCreateWithURL(inputUrl as CFURL, nil),
          CGImageSourceGetCount(source) == 1,
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil)
            as? [CFString: Any],
          let width = properties[kCGImagePropertyPixelWidth] as? Int,
          let height = properties[kCGImagePropertyPixelHeight] as? Int,
          width > 0,
          height > 0 else {
        fail("Image could not be opened")
    }
    guard width <= maximumImageDimension,
          height <= maximumImageDimension,
          width.multipliedReportingOverflow(by: height).overflow == false,
          width * height <= maximumImagePixels else {
        fail("Image exceeds the OCR pixel limit")
    }
    guard let cgImage = CGImageSourceCreateImageAtIndex(
        source,
        0,
        [kCGImageSourceShouldCache: false] as CFDictionary
    ) else {
        fail("Image could not be decoded")
    }
    let orientationValue = (properties[kCGImagePropertyOrientation] as? NSNumber)?.uint32Value ?? 1
    let orientation = CGImagePropertyOrientation(rawValue: orientationValue) ?? .up
    let pages = [recognize(cgImage, index: 1, orientation: orientation)]
    progress(1, 1)
    return pages
}

guard CommandLine.arguments.count == 2 else {
    fail("usage: macos-vision-pdf-ocr.swift <pdf-or-image-path>")
}

let inputUrl = URL(fileURLWithPath: CommandLine.arguments[1])
let inputExtension = inputUrl.pathExtension.lowercased()
let inputKind: String
let pages: [[String: Any]]
if inputExtension == "pdf" {
    inputKind = "pdf"
    pages = pdfPages(inputUrl)
} else if imageExtensions.contains(inputExtension) {
    inputKind = "image"
    pages = imagePage(inputUrl)
} else {
    fail("input must be a PDF, PNG, JPEG, or WebP image")
}

let result: [String: Any] = [
    "providerId": "macos-vision",
    "providerVersion": ProcessInfo.processInfo.operatingSystemVersionString,
    "inputKind": inputKind,
    "pageCount": pages.count,
    "pages": pages,
]

do {
    let data = try JSONSerialization.data(withJSONObject: result, options: [])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
} catch {
    fail("OCR result could not be serialized")
}
