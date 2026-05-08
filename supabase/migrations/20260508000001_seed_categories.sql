-- Seed initial categories on the live project. Mirrors supabase/seed.sql,
-- which only runs on local `supabase db reset` and therefore never reached
-- the linked project. Idempotent via `on conflict (name) do nothing`, so it
-- is safe to re-apply and to coexist with seed.sql for fresh local resets.

insert into public.categories (name, group_name) values
  -- Продукти
  ('Молочка',         'Продукти'),
  ('М''ясо/риба',     'Продукти'),
  ('Овочі/фрукти',    'Продукти'),
  ('Бакалія',         'Продукти'),
  ('Солодке',         'Продукти'),
  ('Алкоголь',        'Продукти'),
  -- Побут
  ('Хімія/гігієна',   'Побут'),
  ('Аптека',          'Побут'),
  ('Одяг',            'Побут'),
  ('Електроніка',     'Побут'),
  -- Житло
  ('Оренда житла',    'Житло'),
  ('Комуналка',       'Житло'),
  -- Транспорт
  ('Авто',            'Транспорт'),
  ('Транспорт',       'Транспорт'),
  -- Розваги
  ('Кафе/ресторани',  'Розваги'),
  ('Розваги',         'Розваги'),
  -- Сервіси
  ('Курси/освіта',    'Сервіси'),
  ('Підписки',        'Сервіси'),
  ('Послуги',         'Сервіси'),
  -- Інше
  ('Інше',            'Інше')
on conflict (name) do nothing;
