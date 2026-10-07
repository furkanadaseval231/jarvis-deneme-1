// Minimal markdown renderer — headings, bullets, bold, inline code and fenced blocks.
// Enough for JARVIS replies and briefing reports without pulling a parser dependency.

interface Props {
  text: string;
  className?: string;
}

function renderInline(line: string, keyBase: string) {
  const parts = line.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, i) => {
    const key = `${keyBase}-${i}`;
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code
          key={key}
          className="rounded bg-cyan-500/12 px-1 py-0.5 font-mono text-[0.85em] text-cyan-200"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={key} className="font-semibold text-slate-50">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

export default function Markdown({ text, className = "" }: Props) {
  const blocks = text.split(/```/);

  return (
    <div className={`space-y-2 text-[0.92rem] leading-relaxed ${className}`}>
      {blocks.map((block, bi) => {
        if (bi % 2 === 1) {
          const [maybeLang, ...rest] = block.split("\n");
          const lang = /^[a-zA-Z0-9+#-]{1,14}$/.test(maybeLang.trim()) ? maybeLang.trim() : "";
          const code = (lang ? rest.join("\n") : block).replace(/\s+$/, "");
          return (
            <pre
              key={bi}
              className="thin-scroll overflow-x-auto rounded-lg border border-cyan-500/20 bg-[#020617] p-3"
            >
              {lang && <div className="mono-label mb-1.5">{lang}</div>}
              <code className="font-mono text-[0.8rem] leading-relaxed text-cyan-100">{code}</code>
            </pre>
          );
        }

        return block.split("\n").map((rawLine, li) => {
          const line = rawLine.trimEnd();
          const key = `${bi}-${li}`;
          if (!line.trim()) return <div key={key} className="h-1" />;

          if (/^#{1,6}\s/.test(line)) {
            const level = (line.match(/^#+/) ?? ["#"])[0].length;
            const content = line.replace(/^#+\s*/, "");
            return (
              <h4
                key={key}
                className={`font-heading font-bold text-slate-100 ${
                  level <= 2 ? "mt-3 text-[1.02rem] cyan-text-glow" : "mt-2 text-[0.95rem]"
                }`}
              >
                {renderInline(content, key)}
              </h4>
            );
          }

          if (/^\s*[-*•]\s+/.test(line)) {
            return (
              <div key={key} className="flex gap-2 pl-1">
                <span className="mt-[0.5em] h-1 w-1 shrink-0 rounded-full bg-cyan-400" />
                <span className="text-slate-300">
                  {renderInline(line.replace(/^\s*[-*•]\s+/, ""), key)}
                </span>
              </div>
            );
          }

          if (/^\s*\d+[.)]\s+/.test(line)) {
            const num = (line.match(/^\s*(\d+)/) ?? ["", ""])[1];
            return (
              <div key={key} className="flex gap-2 pl-1">
                <span className="shrink-0 font-mono text-xs text-cyan-400">{num}.</span>
                <span className="text-slate-300">
                  {renderInline(line.replace(/^\s*\d+[.)]\s+/, ""), key)}
                </span>
              </div>
            );
          }

          if (/^>\s?/.test(line)) {
            return (
              <div
                key={key}
                className="border-l-2 border-amber-400/50 bg-amber-400/5 py-1 pl-3 text-amber-100/90"
              >
                {renderInline(line.replace(/^>\s?/, ""), key)}
              </div>
            );
          }

          return (
            <p key={key} className="text-slate-300">
              {renderInline(line, key)}
            </p>
          );
        });
      })}
    </div>
  );
}
