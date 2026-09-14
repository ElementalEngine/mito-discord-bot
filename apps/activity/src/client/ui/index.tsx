import type { ButtonHTMLAttributes, ReactNode } from 'react';

// A Discord application emoji is an image; 128 is the CDN's ceiling.
export const portraitUrl = (emojiId: string, size: 64 | 96 | 128 = 96): string =>
  `https://cdn.discordapp.com/emojis/${emojiId}.png?size=${size}`;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger';
};

export function Button({ variant = 'ghost', className = '', ...rest }: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ' +
    'transition-colors disabled:cursor-not-allowed disabled:opacity-40';
  const look = {
    primary: 'bg-accent text-accent-ink hover:brightness-110',
    ghost: 'border border-line bg-panel text-ink hover:border-accent/60',
    danger: 'border border-danger/40 bg-panel text-danger hover:bg-danger/10',
  }[variant];

  return <button className={`${base} ${look} ${className}`} {...rest} />;
}

export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-card border border-line bg-panel p-4 ${className}`}>{children}</section>
  );
}

export function Screen({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-3 p-3 sm:p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-wide text-ink sm:text-xl">{title}</h1>
        {meta && <p className="text-xs text-muted sm:text-sm">{meta}</p>}
      </header>
      {children}
    </main>
  );
}

type TileProps = {
  emojiId?: string | null;
  label: string;
  sub?: string;
  selected?: boolean;
  struck?: boolean;
  disabled?: boolean;
  onClick?: () => void;
};

// The face first: the league already knows these portraits from the bot's
// embeds, so the grid reads as the game rather than as a list of tokens.
export function Tile({ emojiId, label, sub, selected, struck, disabled, onClick }: TileProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      className={[
        'group flex w-full flex-col items-center gap-1 rounded-card border p-1.5 transition-colors',
        selected ? 'border-accent bg-accent/10' : 'border-line bg-panel hover:border-accent/50',
        disabled && !selected ? 'opacity-40' : '',
        struck ? 'opacity-30' : '',
      ].join(' ')}
    >
      {emojiId ? (
        <img
          src={portraitUrl(emojiId)}
          alt=""
          loading="lazy"
          width={48}
          height={48}
          className={`h-12 w-12 rounded ${struck ? 'grayscale' : ''}`}
        />
      ) : (
        <span className="grid h-12 w-12 place-items-center rounded bg-line text-xs text-muted">?</span>
      )}
      <span className={`line-clamp-2 text-center text-[11px] leading-tight ${struck ? 'line-through' : ''}`}>
        {label}
      </span>
      {sub && <span className="text-[10px] text-muted">{sub}</span>}
    </button>
  );
}
