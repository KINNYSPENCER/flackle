# App Development Rules

## Tech Stack

- Build the app with **React** and **TypeScript**; do not introduce another frontend framework or plain JavaScript source files.
- Use **React Router** for client-side navigation, and keep all route declarations in `src/App.tsx`.
- Keep application source code under `src/`, with route-level screens in `src/pages/` and reusable UI in `src/components/`.
- Treat `src/pages/Index.tsx` as the default page and update it whenever new homepage-facing components must appear in the app preview.
- Use **Tailwind CSS** for layout, spacing, typography, colors, responsive behavior, and other visual styling.
- Prefer **shadcn/ui** components for standard interface elements such as buttons, forms, dialogs, cards, tables, tabs, and menus.
- Use **Radix UI** primitives when shadcn/ui does not provide the needed behavior or when composing an accessible custom interaction.
- Use **lucide-react** for interface icons instead of hand-drawn SVGs, emoji, icon fonts, or additional icon packages.

## Library and Implementation Rules

- Import existing shadcn/ui components from the project's UI component directory; do not modify the generated shadcn/ui source files. Wrap or compose them in a new component when customization is required.
- Use Tailwind utility classes directly in React components. Add custom CSS only when Tailwind cannot reasonably express the required behavior.
- Use React Router components and hooks for links, navigation, URL parameters, and route state; do not implement page navigation with manual `window.location` changes.
- Use React state and hooks for local UI behavior. Do not add a state-management library unless the app develops a clear cross-page state requirement.
- Use lucide-react icons with accessible labels or surrounding text where needed; decorative icons should not create duplicate announcements for assistive technology.
- Reuse installed libraries before adding dependencies. Add a new package only when the existing stack cannot meet a concrete requirement cleanly.
- Keep components small and focused, keep page-specific logic in its page, and extract a reusable component only when it is genuinely shared or meaningfully simplifies the page.
- Preserve strict TypeScript typing. Avoid `any`, unsafe casts, and duplicated types when a clear shared type can be used.
