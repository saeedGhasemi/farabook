// Inline / block math renderer using KaTeX. Safe-renders LaTeX strings.
import { useMemo } from "react";
import katex from "katex";

interface Props {
  tex: string;
  display?: boolean;
}

export const Math = ({ tex, display = false }: Props) => {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, {
        displayMode: display,
        throwOnError: false,
        strict: "ignore",
        trust: false,
        output: "html",
      });
    } catch {
      return `<span class="text-destructive">${tex}</span>`;
    }
  }, [tex, display]);
  if (display) {
    return (
      <span
        className="block my-3 overflow-x-auto text-center"
        dir="ltr"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return <span dir="ltr" dangerouslySetInnerHTML={{ __html: html }} />;
};

export default Math;
