-- Seed data for Finance Tracker. Loaded by `supabase db reset` after migrations.
-- Mirrors docs/data-model.md §Categories.
--
-- To grant a user access, add their email to public.app_users via Supabase Studio
-- after the project is set up:
--   insert into public.app_users (email) values ('you@example.com');
--   insert into public.app_users (email) values ('FIANCEE_EMAIL_HERE');

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
  ('Інше',            'Інше'),
  ('Pfand',           'Інше')
on conflict (name) do nothing;
