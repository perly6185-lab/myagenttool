import { useState } from "react";
import { Clipboard, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { webNavigationLinkDeepLink } from "@/app/deep-links";
import { cn } from "@/lib/cn";
import type { WebNavigationLink } from "@/lib/console-state";

export function WebNavigationLinkActions({
  title,
  links,
  onOpen,
  className,
}: {
  title: string;
  links: Array<WebNavigationLink | null | undefined>;
  onOpen: (link: WebNavigationLink) => void;
  className?: string;
}) {
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const entries = links.filter(isWebNavigationLink);
  if (!entries.length) return null;

  function copyLink(link: WebNavigationLink) {
    void navigator.clipboard?.writeText(webNavigationLinkDeepLink(link));
    setCopiedLabel(link.label);
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium">{title}</p>
        {copiedLabel ? <span className="text-xs text-success">Copied {copiedLabel}.</span> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {entries.map((link) => (
          <span key={`${link.label}:${link.query}`} className="inline-flex items-center gap-1">
            <Button size="sm" variant="secondary" onClick={() => onOpen(link)}>
              <ExternalLink />
              {link.label}
            </Button>
            <Button
              size="icon"
              variant="secondary"
              title={`Copy ${link.label}`}
              aria-label={`Copy ${link.label}`}
              onClick={() => copyLink(link)}
            >
              <Clipboard />
            </Button>
          </span>
        ))}
      </div>
    </div>
  );
}

function isWebNavigationLink(value: WebNavigationLink | null | undefined): value is WebNavigationLink {
  return Boolean(value && typeof value.label === "string" && typeof value.query === "string" && value.target);
}
