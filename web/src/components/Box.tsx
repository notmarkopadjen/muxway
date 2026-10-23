import type { ReactNode } from 'react';

export function Box({
  title,
  children,
  className,
  active,
  enter = true,
  testId,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
  active?: boolean;
  enter?: boolean;
  testId?: string;
}) {
  const cls = ['mx-box', active ? 'mx-active' : '', enter ? 'mx-panel-enter' : '', className ?? '']
    .filter(Boolean)
    .join(' ');
  return (
    <section className={cls} data-testid={testId}>
      {title && <span className="mx-box-title">{title}</span>}
      {children}
    </section>
  );
}
