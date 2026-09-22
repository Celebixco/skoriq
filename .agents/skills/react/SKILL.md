---
name: react
description: Modern React 19 development patterns with hooks, Server Components, Suspense, and performance optimization
---

## React Development Best Practices

### Component Architecture

- Use **functional components** exclusively; avoid class components
- Keep components **small and focused** (single responsibility)
- Co-locate related logic: hooks, styles, and sub-components near parent

### Hooks Rules

```tsx
// ✅ DO: Keep hooks at the top level
function Counter() {
  const [count, setCount] = useState(0);
  const doubled = useMemo(() => count * 2, [count]);
  
  useEffect(() => {
    document.title = `Count: ${count}`;
  }, [count]);
  
  return <button onClick={() => setCount(c => c + 1)}>{doubled}</button>;
}
```

- Never call hooks inside loops, conditions, or nested functions
- Use `useMemo` for expensive computations and `useCallback` for stable function references passed to child components
- Prefer custom hooks to extract and reuse stateful logic

### Server Components (Next.js / React 19)

- Default to **Server Components** when possible
- Use **Client Components** (`'use client'`) ONLY for:
  - Browser APIs (`window`, `document`, `localStorage`)
  - Event handlers (`onClick`, `onSubmit`)
  - Hooks that require client context (`useState`, `useEffect`)
  - React Context providers

### State Management

- Start with `useState` / `useReducer`
- Lift state up only when necessary
- For global state, prefer **Zustand** or **Jotai** over Redux for simplicity
- Keep state as close to where it's used as possible

### Performance

- Use `React.memo` for pure components receiving complex props
- Avoid anonymous functions and objects in JSX props unless memoized
- Code-split heavy components with `dynamic()` or `React.lazy`
- Use `Suspense` boundaries around async data and lazy components

### TypeScript with React

```tsx
interface ButtonProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
  onClick?: () => void;
}

export function Button({ children, variant = 'primary', onClick }: ButtonProps) {
  return <button className={variant} onClick={onClick}>{children}</button>;
}
```

- Always type props with interfaces
- Use `React.FC` sparingly; explicit props typing is preferred
- Return type `JSX.Element` or `React.ReactNode` for flexibility
