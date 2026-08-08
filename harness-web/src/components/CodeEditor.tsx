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
 * Theme is hand-rolled against the app palette rather than a stock one, so the
 * editor doesn't read as a different product bolted into the page.
 */

const surface = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent', color: '#e8e6e3', fontSize: '12.5px' },
    '.cm-content': {
      fontFamily: 'var(--font-geist-mono), ui-monospace, monospace',
      padding: '14px 0',
      lineHeight: '1.65',
    },
    '.cm-gutters': {
      backgroundColor: 'transparent',
      border: 'none',
      color: '#3c3c44',
      paddingRight: '4px',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 18px' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.022)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#7a7a84' },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor': { borderLeftColor: '#d8a34a' },
    '.cm-selectionBackground, ::selection': { backgroundColor: '#2b2519 !important' },
    '.cm-scroller': { overflow: 'auto' },
  },
  { dark: true },
);

const syntax = HighlightStyle.define([
  { tag: t.keyword, color: '#d8a34a' },
  { tag: [t.controlKeyword, t.moduleKeyword], color: '#d8a34a' },
  { tag: [t.string, t.special(t.string)], color: '#9ac48a' },
  { tag: [t.number, t.bool], color: '#c99b6e' },
  { tag: t.comment, color: '#5a5a63', fontStyle: 'italic' },
  { tag: [t.typeName, t.className], color: '#7fa6c9' },
  { tag: [t.function(t.variableName), t.definition(t.variableName)], color: '#e8e6e3' },
  { tag: t.variableName, color: '#bdbdc6' },
  { tag: t.operator, color: '#8a8a94' },
  { tag: t.propertyName, color: '#bdbdc6' },
  { tag: t.atom, color: '#c99b6e' },
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
      height="calc(100vh - 108px)"
      extensions={[solidity, surface, syntaxHighlighting(syntax)]}
      editable={!readOnly}
      onChange={onChange}
      className="scroll"
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: !readOnly,
        highlightActiveLineGutter: !readOnly,
      }}
    />
  );
}
