import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PlainMailBody, sanitizeMailHtml } from "@/features/mail/safe-mail-content";

describe("safe mail content", () => {
  it("linkifies only complete HTTP(S) URLs and leaves unsafe schemes as text", () => {
    render(<PlainMailBody body={"Open https://example.com/a?x=1&y=2. Ignore javascript:alert(1)."} />);
    const link = screen.getByRole("link", { name: "https://example.com/a?x=1&y=2" });
    expect(link.getAttribute("href")).toBe("https://example.com/a?x=1&y=2");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("removes active HTML and blocks remote images by default", () => {
    const result = sanitizeMailHtml('<style>body{display:none}</style><script>alert(1)</script><form action="https://evil.test"><input></form><a href="javascript:alert(2)" onclick="steal()">Unsafe</a><img src="https://tracker.test/pixel" alt="Tracker">');
    expect(result).not.toContain("<script");
    expect(result).not.toContain("<form");
    expect(result).not.toContain("javascript:");
    expect(result).not.toContain("onclick");
    expect(result).not.toContain("https://tracker.test/pixel");
    expect(result).toContain("Remote image blocked: Tracker");
    expect(result).toContain("default-src 'none'");
  });

  it("loads only approved remote URLs and verified CID data images", () => {
    const html = '<a href="https://example.com/path">Open</a><img src="https://img.example.com/a.png" alt="Remote"><img src="cid:logo%40mail" alt="Logo"><img src="data:image/svg+xml;base64,bad" alt="Raw">';
    const result = sanitizeMailHtml(html, {
      allowRemoteImages: true,
      cidImages: { "logo@mail": "data:image/png;base64,c2FmZQ==" },
    });
    expect(result).toContain('href="https://example.com/path"');
    expect(result).toContain("[example.com]");
    expect(result).toContain('src="https://img.example.com/a.png"');
    expect(result).toContain('referrerpolicy="no-referrer"');
    expect(result).toContain('src="data:image/png;base64,c2FmZQ=="');
    expect(result).not.toContain("data:image/svg+xml");
  });
});
