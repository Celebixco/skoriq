---
name: motion
description: React animations with Motion (Framer Motion) - declarative animations, gestures, scroll effects, and layout transitions
---

## Motion (Framer Motion) Animation Guide

### Basic Usage

```tsx
import { motion } from "framer-motion";

<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.5, ease: "easeOut" }}
>
  Hello Motion
</motion.div>
```

### Variants for Orchestration

```tsx
const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 }
  }
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 }
};

<motion.ul variants={container} initial="hidden" animate="show">
  {items.map(i => <motion.li key={i} variants={item} />)}
</motion.ul>
```

### Gestures

```tsx
<motion.button
  whileHover={{ scale: 1.05 }}
  whileTap={{ scale: 0.95 }}
  whileDrag={{ scale: 1.1 }}
/>
```

### Scroll Animations

```tsx
<motion.div
  initial={{ opacity: 0 }}
  whileInView={{ opacity: 1 }}
  viewport={{ once: true, amount: 0.5 }}
/>
```

### Layout Animations

```tsx
<motion.div layout style={{ borderRadius: isOpen ? 20 : 8 }} />
```

Use `layout` prop for automatic smooth position/size transitions when DOM changes.

### Performance Tips

- Animate only `transform` and `opacity` when possible (GPU-accelerated)
- Use `will-change: transform` sparingly
- Prefer `layout` over manual measuring for responsive animations
- Use `LazyMotion` to reduce bundle size by loading features on demand
