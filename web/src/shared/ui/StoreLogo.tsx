import { useState } from 'react';
import { cn } from '@/shared/ui/cn';
import { resolveStoreLogo } from '@/shared/ui/store-logos';

type Props = {
  store: string;
  className?: string;
};

// Brand logo for a receipt's store, inferred from its free-text name. Falls back
// to a neutral storefront glyph when the name matches no known brand or the image
// fails to load. Fixed size + shrink-0 so it never squeezes the truncated store
// name text beside it.
export function StoreLogo({ store, className }: Props) {
  const logo = resolveStoreLogo(store);
  const [imgError, setImgError] = useState(false);

  if (logo && !imgError) {
    return (
      <img
        src={logo.src}
        alt={store}
        loading="lazy"
        onError={() => setImgError(true)}
        className={cn('size-5 shrink-0 rounded-sm object-contain', className)}
      />
    );
  }

  return <StorefrontGlyph className={className} />;
}

function StorefrontGlyph({ className }: { className?: string | undefined }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('size-5 shrink-0 text-slate-400', className)}
    >
      <path d="M3 9.5 4.2 4.5h15.6L21 9.5" />
      <path d="M3 9.5a2.4 2.4 0 0 0 4.5 0 2.4 2.4 0 0 0 4.5 0 2.4 2.4 0 0 0 4.5 0 2.4 2.4 0 0 0 4.5 0" />
      <path d="M4.5 11v8.5h15V11" />
      <path d="M9.5 19.5V14h5v5.5" />
    </svg>
  );
}
