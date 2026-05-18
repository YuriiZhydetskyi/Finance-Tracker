-- Waste tracking: дата останнього викидання + агрегатна view "по місяцях".
--
-- wasted_at єдине поле, перезаписується на now() при кожному оновленні з
-- wasted_qty > 0; nulled, коли wasted_qty повертається в 0. Single-column
-- модель — як для wasted_qty в ADR-0009. Якщо колись знадобиться повна
-- історія викидань — мігруємо в окрему таблицю; колонка лишиться як
-- "last wasted at" і view не зміниться.

alter table public.items add column wasted_at timestamptz;
comment on column public.items.wasted_at is
  'Set to now() when wasted_qty becomes >0; nulled when wasted_qty=0. Overwritten on each update.';

-- "Waste by month" чарт. Сума втрат у EUR — пропорційна частка від total_eur,
-- де частка = wasted_qty / qty. Жодних дат на самій локальній колонці —
-- агрегуємо за датою чека, як інші *_by_month view. count() — кількість item
-- рядків з ненульовим wasted_qty за місяць.
create view public.v_stats_waste_by_month
  with (security_invoker = on)
as
select
  to_char(r.date, 'YYYY-MM')                                            as month,
  sum((i.wasted_qty / nullif(i.qty, 0)) * i.total_eur)::numeric(14,2)   as wasted_value_eur,
  count(*) filter (where i.wasted_qty > 0)::int                          as wasted_items_count
from public.items i
join public.receipts r on r.id = i.receipt_id
where i.wasted_qty > 0
group by to_char(r.date, 'YYYY-MM')
order by to_char(r.date, 'YYYY-MM') desc;
