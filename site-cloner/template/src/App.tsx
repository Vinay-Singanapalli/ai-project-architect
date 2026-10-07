import { sections } from './sections';
import SectionBoundary from './lib/SectionBoundary';

/** Renders the page as an ordered list of independent section components (see src/sections/index.ts). */
export default function App() {
  return (
    <div className="app">
      {sections.map(({ id, type, anchor, Component }) => (
        <SectionBoundary key={id} id={id}>
          <div id={anchor ?? id} data-section={id} data-section-type={type}>
            <Component />
          </div>
        </SectionBoundary>
      ))}
    </div>
  );
}
