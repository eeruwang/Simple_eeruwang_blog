-- db/seed.sql
insert into posts (slug, title, body_md, tags, is_page, published, published_at)
values
('hello', '안녕하세요', '첫 포스트입니다', array['diary'], false, true, now())
on conflict do nothing;

insert into posts (slug, title, body_md, tags, is_page, published)
values
('about', 'About', '여기는 소개 페이지', array['page'], true, true)
on conflict do nothing;
