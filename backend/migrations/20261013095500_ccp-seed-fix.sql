-- Seed corrections after probing the live feeds on 13 Oct 2026: wrong tokens are deactivated,
-- CDW's Workday site fixed, and two verified Greenhouse boards added.
update public.companies set active = false where (ats, token) in (
  ('workday','kimleyhorn|wd1|KimleyHorn'), ('workday','kiewit|wd1|KiewitCareers'), ('workday','wsp|wd3|WSPUSA'),
  ('workday','hdr|wd1|HDR_Careers'), ('workday','stantec|wd3|Stantec'), ('workday','turnerconstruction|wd1|TurnerConstructionCompany'),
  ('workday','skanska|wd1|SkanskaUSA'), ('workday','insight|wd1|Insight'), ('workday','teksystems|wd1|TEKsystems'),
  ('smartrecruiters','Terracon'), ('smartrecruiters','InsightGlobal'), ('greenhouse','langan'), ('greenhouse','thorntontomasetti'),
  ('greenhouse','bowman'), ('greenhouse','atwell'), ('greenhouse','rackspace'), ('greenhouse','arcticwolf'), ('greenhouse','hashicorp'),
  ('lever','lightspeedhq'));
update public.companies set token = 'cdw|wd5|Careers', careers_url = 'https://cdw.wd5.myworkdayjobs.com/Careers' where ats = 'workday' and token = 'cdw|wd1|External';
insert into public.companies (name, ats, token, fields, locations, careers_url) values
  ('Atwell', 'greenhouse', 'atwellgroup', '{civil}', '{US}', 'https://boards.greenhouse.io/atwellgroup'),
  ('BGE, Inc.', 'greenhouse', 'bgeinc', '{civil}', '{TX,US}', 'https://boards.greenhouse.io/bgeinc')
on conflict (ats, token) do nothing;
