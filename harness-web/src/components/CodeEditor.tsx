'use client';

import CodeMirror from '@uiw/react-codemirror';
import { solidity } from '@replit/codemirror-lang-solidity';
import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/**
 * `solidity` is a LanguageSupport value, not a factory — `solidity()` throws.
 * Always loaded via dynamic(..., { ssr: false }): EditorView's constructor needs
 * `document` and dies during prerender.
 *
 * Light theme on the wizard's own gray ramp. A dark editor inside a light shell
 * is the single thing that would make this read as two products stitched together.
 */

const surface = EditorView.theme(
  {
    '&': { backgroundColor: 'white', color: 'var(--text-color)', fontSize: '13px' },
    '.cm-content': {
      fontFamily: 'var(--monospace)',
      padding: '16px 0',
      lineHeight: '1.6',
    },
    '.cm-gutters': {
      backgroundColor: 'white',
      border: 'none',
      color: 'var(--gray-3)',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 20px' },
    '.cm-activeLine': { backgroundColor: 'var(--blue-1)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--gray-4)' },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor': { borderLeftColor: 'var(--blue-2)' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--blue-1) !important',
    },
  },
  { dark: false },
);

const syntax = HighlightStyle.define([
  { tag: t.keyword, color: '#8250df' },
  { tag: [t.controlKeyword, t.moduleKeyword], color: '#cf222e' },
  { tag: [t.string, t.special(t.string)], color: '#0a3069' },
  { tag: [t.number, t.bool, t.atom], color: '#0550ae' },
  { tag: t.comment, color: 'var(--gray-4)', fontStyle: 'italic' },
  { tag: [t.typeName, t.className], color: '#953800' },
  { tag: [t.function(t.variableName), t.definition(t.variableName)], color: '#6639ba' },
  { tag: t.variableName, color: 'var(--text-color)' },
  { tag: t.operator, color: 'var(--gray-5)' },
  { tag: t.propertyName, color: 'var(--text-color)' },
]);

export default function CodeEditor({
  value,
  onChange,
  readOnly = false,
}: {
  value: string;
  onChange?: (v: string) => void;
  readOnly?: boolean;
}) {
  return (
    <CodeMirror
      value={value}
      height="100%"
      extensions={[solidity, surface, syntaxHighlighting(syntax)]}
      editable={!readOnly}
      onChange={onChange}
      className="scroll h-full"
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: !readOnly,
        highlightActiveLineGutter: !readOnly,
      }}
    />
  );
}
