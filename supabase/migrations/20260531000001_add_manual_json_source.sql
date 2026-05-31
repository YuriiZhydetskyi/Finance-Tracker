-- Add 'manual-json' to receipt_source enum.
-- Used by the "Paste AI JSON" flow on /photo: the user runs the prompt in an
-- external AI tool (ChatGPT/Claude desktop), pastes the resulting JSON, and
-- the receipt is saved without going through the Edge Function. There's no
-- photo upload involved, so 'photo' would be misleading attribution — and
-- 'manual' wouldn't distinguish it from receipts typed in the manual form.

alter type public.receipt_source add value if not exists 'manual-json';
