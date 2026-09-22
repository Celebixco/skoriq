---
name: frontend-dev-guidelines
description: Frontend development guidelines for React/TypeScript applications with modern patterns and performance optimization
---

## Frontend Development Guidelines

### Project Structure

```
src/
├── components/     # Reusable UI components
├── features/       # Feature-specific modules
├── hooks/          # Custom React hooks
├── lib/            # Utilities and helpers
├── styles/         # Global styles, themes
└── types/          # Shared TypeScript types
```

### Code Style

- Use **Prettier** for formatting and **ESLint** for linting
- Line length: 100 characters
- Prefer named exports for components
- Group imports: React, libraries, absolute paths, relative paths

### Component Patterns

- **Container / Presentational** split when useful
- **Compound Components** for complex UI (tabs, accordions)
- **Render Props** and **HOCs** are legacy; prefer hooks and composition

### Data Fetching

- In Next.js App Router: fetch in Server Components by default
- Use **TanStack Query (React Query)** for client-side data
- Always handle loading, error, and empty states explicitly

### Accessibility (a11y)

- Semantic HTML: `<button>` for actions, `<a>` for navigation
- `alt` text on images, `aria-label` where text is missing
- Keyboard navigation and focus management
- Color contrast ratio minimum 4.5:1

### Testing

- **Vitest** for unit tests
- **React Testing Library** for component tests
- **Playwright** for E2E tests
- Test behavior, not implementation
