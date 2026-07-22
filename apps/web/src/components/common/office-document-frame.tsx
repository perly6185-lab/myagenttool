import { cn } from "@/lib/cn";

const OFFICE_DOCUMENT_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">`;

/** Static OfficeCLI HTML renderer with one shared, locked-down security policy. */
export function OfficeDocumentFrame({ title, content, className }: { title: string; content: string; className?: string }) {
  return (
    <iframe
      title={title}
      sandbox=""
      srcDoc={`${OFFICE_DOCUMENT_CSP}${content}`}
      className={cn("h-full min-h-[24rem] w-full bg-white", className)}
    />
  );
}
