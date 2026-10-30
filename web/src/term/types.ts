// The files a host shows, by extension or by name: the protocol's list
// (docs/protocol/v1.md), the one the agent applies; anything else under a
// root is a download, but the secrets named here, which the host never
// serves and the matcher never underlines. The inbox sends any text of the
// list as plain text.

export const TEXT_EXTS = `txt md markdown rst adoc org tex bib diff patch
csv tsv json jsonl ndjson json5 jsonc geojson ipynb log
yaml yml toml ini cfg conf properties props lock
xml xsd xsl xslt dtd plist svg html htm xhtml css scss sass less styl
js jsx mjs cjs ts tsx vue svelte astro coffee
cs csx cshtml razor csproj vbproj fsproj sln targets nuspec pubxml xaml axaml resx config
go mod sum py pyi pyx pxd pxi rb erb rake gemspec
rs java kt kts gradle groovy scala sbt clj cljs cljc edn el scm rkt lisp
c h cpp hpp cc cxx hh hxx inl cu cuh m mm
swift dart php pl pm lua r rmd jl hs lhs ex exs erl hrl ml mli fs fsx fsi vb pas d nim zig v cr elm
sh bash zsh fish ps1 psm1 psd1 bat cmd awk
sql graphql gql proto tf tfvars hcl nix cmake mk
http rest ics webmanifest map service timer socket mount
tpl tmpl mako jinja jinja2 j2 hbs mustache ejs njk liquid
f f90 f95 f03 for s asm glsl hlsl vert frag sol wat`.split(/\s+/);

export const TEXT_NAMES =
  `makefile gnumakefile dockerfile containerfile jenkinsfile vagrantfile gemfile rakefile procfile brewfile
license licence notice readme changelog changes authors contributors copying todo install version codeowners`.split(
    /\s+/,
  );

export const DENIED_EXTS =
  `env pem key crt cer der p12 pfx jks keystore kdbx ovpn asc gpg pgp tfstate`.split(/\s+/);

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif'];
export const OTHER_EXTS = [
  'pdf',
  'zip',
  'gz',
  'tgz',
  'tar',
  '7z',
  'docx',
  'xlsx',
  'pptx',
  'odt',
  'ods',
  'odp',
];

const text = new Set(TEXT_EXTS);
const names = new Set(TEXT_NAMES);

// The extension of a name, lowercased, or '' without one.
export function extOf(name: string): string {
  const base = name.slice(name.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

// Whether a file name is one the host serves as text.
export function isTextName(name: string): boolean {
  const ext = extOf(name);
  if (ext) return text.has(ext);
  return names.has(name.slice(name.lastIndexOf('/') + 1).toLowerCase());
}

const alternation = (list: string[]) => [...list].sort((a, b) => b.length - a.length).join('|');

// The alternations for a matcher: the extensions a host keeps out, and the
// names it shows without one. Case does not matter.
export const DENIED_ALT = alternation(DENIED_EXTS);
export const NAME_ALT = alternation(TEXT_NAMES);
