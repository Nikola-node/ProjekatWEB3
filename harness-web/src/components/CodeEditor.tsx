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
 * The code surface is deliberately the one dark element on the page: a warm
 * near-black, not a blue-black, so it reads as a different material from the white
 * cards rather than a different product. Syntax carries real colour — on a dark
 * ground it can, without the muddiness the same hues have on white.
 */

const surface = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--code-bg)',
      color: 'var(--code-fg)',
      fontSize: '12px',
      height: '100%',
    },
    '.cm-content': {
      fontFamily: 'var(--monospace)',
      padding: '12px 0',
      lineHeight: '1.55',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--code-bg)',
      border: 'none',
      color: 'var(--code-gutter)',
      fontSize: '11px',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 14px' },
    '.cm-activeLine': { backgroundColor: 'var(--code-line)' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#8a847d' },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor': { borderLeftColor: '#f0b45a' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: '#3d3a33 !important',
    },
    '.cm-scroller': { overflow: 'auto' },
  },
  { dark: true },
);

const syntax = HighlightStyle.define([
  { tag: t.keyword, color: '#e888b8' },
  { tag: [t.controlKeyword, t.moduleKeyword], color: '#e888b8' },
  { tag: [t.string, t.special(t.string)], color: '#9fce6b' },
  { tag: [t.number, t.bool, t.atom], color: '#f0a45a' },
  { tag: t.comment, color: '#7d766d', fontStyle: 'italic' },
  { tag: [t.typeName, t.className], color: '#63c8c0' },
  { tag: [t.function(t.variableName), t.definition(t.variableName)], color: '#8ab6f0' },
  { tag: t.variableName, color: '#e6e2dc' },
  { tag: t.operator, color: '#c0b8ae' },
  { tag: t.propertyName, color: '#e6e2dc' },
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
      className="scroll-dark h-full"
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: !readOnly,
        highlightActiveLineGutter: !readOnly,
      }}
    />
  );
}
