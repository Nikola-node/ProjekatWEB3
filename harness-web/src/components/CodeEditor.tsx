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
 * theme="none" matters. @uiw/react-codemirror defaults to theme="light" and
 * appends that extension AFTER anything passed in `extensions`, so a custom
 * theme silently loses the cascade and the editor renders white regardless.
 *
 * The code surface is the one dark element in the light theme, and stays dark in
 * the dark theme: a warm near-black so it reads as a different material from the
 * panels rather than a different product.
 */

const surface = EditorView.theme(
  {
    '&': {
      backgroundColor: '#1b1a19',
      color: '#e8e4dd',
      fontSize: '11.5px',
      height: '100%',
    },
    '.cm-content': {
      fontFamily: 'var(--monospace)',
      padding: '10px 0',
      lineHeight: '1.5',
      caretColor: '#f0b45a',
    },
    '.cm-editor': { backgroundColor: '#1b1a19' },
    '.cm-gutters': {
      backgroundColor: '#1b1a19',
      border: 'none',
      color: '#56524c',
      fontSize: '10.5px',
    },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px' },
    '.cm-activeLine': { backgroundColor: '#262421' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#8a847d' },
    '&.cm-focused': { outline: 'none' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#f0b45a' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: '#3d3a33' },
    '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--monospace)' },
  },
  { dark: true },
);

const syntax = HighlightStyle.define([
  { tag: t.keyword, color: '#f291c0' },
  { tag: [t.controlKeyword, t.moduleKeyword], color: '#f291c0' },
  { tag: [t.string, t.special(t.string)], color: '#a8d977' },
  { tag: [t.number, t.bool, t.atom], color: '#f5ad63' },
  { tag: t.comment, color: '#807870', fontStyle: 'italic' },
  { tag: [t.typeName, t.className], color: '#6fd4cb' },
  { tag: [t.function(t.variableName), t.definition(t.variableName)], color: '#93bdf7' },
  { tag: t.variableName, color: '#e8e4dd' },
  { tag: t.operator, color: '#c6bdb2' },
  { tag: t.propertyName, color: '#e8e4dd' },
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
    <div className="h-full overflow-hidden" style={{ background: '#1b1a19' }}>
      <CodeMirror
        value={value}
        height="100%"
        theme="none"
        extensions={[solidity, surface, syntaxHighlighting(syntax)]}
        editable={!readOnly}
        onChange={onChange}
        className="h-full"
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: !readOnly,
          highlightActiveLineGutter: !readOnly,
        }}
      />
    </div>
  );
}
