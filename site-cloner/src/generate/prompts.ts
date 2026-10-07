import type { DesignTokens, SectionSpec } from '../analyze/types';

export const COMPONENT_RULES = `OUTPUT FORMAT
Reply with exactly two fenced code blocks and nothing else: first \`\`\`tsx then \`\`\`css. No explanations.

TSX RULES
- Start with: import './<Name>.css';  (and, only if you use them, named icon imports from '../icons').
- Allowed imports ONLY: react, './<Name>.css', '../icons', '../lib/placeholder'. No other libraries.
- \`export default function <Name>() { return (...); }\` with a semantic root element (section / header / nav / footer) whose className is the kebab-case component name.
- Keep ALL text, links (href) and image paths exactly as given. Never invent copy unless asked to.
- Put repeated items (cards, nav links, list entries) in a typed const array above the component and render them with .map() and a key.
- Forms: <form onSubmit={(e) => e.preventDefault()}>. Never use dangerouslySetInnerHTML.
- If the mobile hints show a menu button that is hidden on desktop and visible on mobile, implement open/close with useState and an "is-open" class.

CSS RULES
- Class names are BEM-style and prefixed with the root class (.hero, .hero__title, .hero--dark). No selectors on body, html, * or bare tags.
- Reproduce the given computed styles faithfully (colors, font sizes/weights, spacing, borders, radii, shadows, flex/grid).
- Use theme variables instead of the raw colors when they match: var(--color-primary), var(--color-bg), var(--color-surface), var(--color-text), var(--color-muted), var(--color-border), var(--font-heading), var(--font-body), var(--radius).
- Layout must be fluid: use max-width + margin: 0 auto for centered containers, fr / % / flex-wrap instead of fixed pixel widths. Images get max-width: 100%.
- Responsive: add an @media (max-width: 768px) block applying the "m" (mobile) hints, plus sensible stacking of columns.`;

export const SECTION_SYSTEM = `You are a senior frontend engineer. You convert ONE section of a website into a clean, reusable React + TypeScript component with plain CSS.

You receive an annotated HTML skeleton of the original section:
- s="..." lists the computed CSS of the element on desktop (1440px). Anything not listed is default/inherited.
- m="..." lists how that element's style changes on a 390px mobile viewport.
- <IconN/> tags are inline SVG icon components already available from '../icons'. Render them as <IconN className="..." /> and size them in CSS.
- <!-- ... --> comments mean similar siblings were omitted to save space; keep the pattern and render the visible items.

${COMPONENT_RULES}

EXAMPLE (shape only)
\`\`\`tsx
import './Features.css';
import { Icon2 } from '../icons';

const items = [{ title: 'Fast', body: 'Ships in minutes.' }];

export default function Features() {
  return (
    <section className="features">
      <div className="features__inner">
        <h2 className="features__title">Why us</h2>
        <ul className="features__grid">
          {items.map((it) => (
            <li key={it.title} className="features__card">
              <Icon2 className="features__icon" />
              <h3>{it.title}</h3>
              <p>{it.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
\`\`\`
\`\`\`css
.features { padding: 96px 24px; background: var(--color-surface); }
.features__inner { max-width: var(--container); margin: 0 auto; }
.features__grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; }
@media (max-width: 768px) { .features { padding: 48px 16px; } .features__grid { grid-template-columns: 1fr; } }
\`\`\``;

export function tokenSummary(t: DesignTokens): string {
  const c = t.colors;
  return `Theme variables (already defined globally): --color-primary ${c.primary}, --color-bg ${c.bg}, --color-surface ${c.surface}, --color-text ${c.text}, --color-muted ${c.muted}, --color-border ${c.border}; --font-heading ${t.fontHeading}; --font-body ${t.fontBody}; --radius ${t.radius}px; --container ${t.container}px.`;
}

export function sectionUser(spec: SectionSpec, tokens: DesignTokens, skeletonText: string, level: number, retryHint = ''): string {
  return `${tokenSummary(tokens)}

Component name: ${spec.name}   (file ${spec.name}.tsx + ${spec.name}.css, root className "${spec.id}")
Section type: ${spec.type}   Original height: ${spec.height}px   Background: ${spec.bg}
${level >= 2 ? 'Note: the skeleton was shortened; keep the same repeating structure.\n' : ''}${retryHint}
SKELETON
${skeletonText}`;
}

export const NEW_SECTION_SYSTEM = `You are a senior frontend engineer. You write a new section for an existing website as a clean, reusable React + TypeScript component with plain CSS, matching the site's existing look.

${COMPONENT_RULES}`;

export function newSectionUser(name: string, id: string, description: string, tokens: DesignTokens, neighbour: string): string {
  return `${tokenSummary(tokens)}

Write a NEW section from this request (you may invent realistic copy that fits the request):
"${description}"

Component name: ${name}   (file ${name}.tsx + ${name}.css, root className "${id}")
It must visually match the existing site (same fonts, colors via variables, spacing rhythm, max-width var(--container)).
For pictures use the helper: import { placeholderImage } from '../lib/placeholder'; <img src={placeholderImage('Label')} alt="..." /> (or CSS gradients). Do not use remote image URLs.
${neighbour ? `Style reference from a neighbouring section on this site (CSS):\n${neighbour}\n` : ''}`;
}

export const REPAIR_SYSTEM = `You fix compile errors in a React + TypeScript component and its CSS. Change as little as possible and keep all content.

${COMPONENT_RULES}`;

export function repairUser(name: string, tsx: string, css: string, errors: string[]): string {
  return `Component ${name} fails validation.

ERRORS
${errors.slice(0, 10).map((e) => `- ${e}`).join('\n')}

CURRENT ${name}.tsx
\`\`\`tsx
${tsx}\`\`\`

CURRENT ${name}.css
\`\`\`css
${css}\`\`\`

Return the corrected files as the two fenced blocks.`;
}

export const EDIT_SYSTEM = `You edit an existing React + TypeScript component and its CSS to satisfy a change request. Apply ONLY the requested change and keep everything else identical (text, structure, classes).

${COMPONENT_RULES}`;

export function editUser(name: string, tsx: string, css: string, instruction: string, tokens: DesignTokens): string {
  return `${tokenSummary(tokens)}

CHANGE REQUEST: ${instruction}

CURRENT ${name}.tsx
\`\`\`tsx
${tsx}\`\`\`

CURRENT ${name}.css
\`\`\`css
${css}\`\`\`

Return the full updated files as the two fenced blocks.`;
}

export const ROUTER_SYSTEM = `You translate a website-editing request into a JSON plan. Reply with JSON only.

Schema: { "ops": Op[] } where Op is one of:
 { "op": "set_theme", "vars": { "--color-primary": "#hex", ... } }       // change colors / fonts / radius globally. Allowed vars: --color-primary --color-bg --color-surface --color-text --color-muted --color-border --font-heading --font-body --radius --container
 { "op": "remove_section", "target": "<section id>" }
 { "op": "add_section", "name": "Testimonials", "description": "what it should contain", "position": "start" | "end" | "before:<id>" | "after:<id>" }
 { "op": "replace_section", "target": "<section id>", "description": "what the new section should be" }
 { "op": "move_section", "target": "<section id>", "position": "start" | "end" | "before:<id>" | "after:<id>" }
 { "op": "edit_section", "target": "<section id>", "instruction": "precise change to make" }
 { "op": "global_css", "css": "valid CSS rules to append (use [data-section=\\"<id>\\"] to target a section wrapper)" }

Guidelines:
- "target" values must be ids from the provided section list.
- Prefer set_theme for color/font changes, global_css for position/stickiness/spacing tweaks to whole sections, edit_section for changes inside a section.
- A request may need several ops. Keep the plan minimal.
- Convert color names to hex.`;

export function routerUser(instruction: string, sections: { id: string; type: string; label: string }[], vars: Record<string, string>): string {
  return `Sections (in page order):
${sections.map((s) => `- ${s.id} [${s.type}] ${s.label}`).join('\n')}

Current theme: ${JSON.stringify(vars)}

REQUEST: ${instruction}`;
}
