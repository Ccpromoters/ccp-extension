-- Starter list of employers whose career sites expose a public job feed the research function can read.
-- token = the board identifier the ATS API expects; workday tokens are "tenant|wdN|site".
insert into public.companies (name, ats, token, fields, locations, careers_url) values
  -- civil / construction / engineering consulting
  ('Wade Trim', 'lever', 'wadetrim', '{civil}', '{MI,OH,FL,PA}', 'https://jobs.lever.co/wadetrim'),
  ('DPR Construction', 'workday', 'mydpr|wd5|11212017', '{civil,construction}', '{TX,CA,US}', 'https://mydpr.wd5.myworkdayjobs.com/11212017'),
  ('Webber (Ferrovial)', 'workday', 'ferrovial|wd3|Ferrovial_Career_Site', '{civil,construction}', '{TX,US}', 'https://ferrovial.wd3.myworkdayjobs.com/Ferrovial_Career_Site'),
  ('Kimley-Horn', 'workday', 'kimleyhorn|wd1|KimleyHorn', '{civil}', '{US}', 'https://kimleyhorn.wd1.myworkdayjobs.com/KimleyHorn'),
  ('Kiewit', 'workday', 'kiewit|wd1|KiewitCareers', '{civil,construction}', '{US}', 'https://kiewit.wd1.myworkdayjobs.com/KiewitCareers'),
  ('WSP USA', 'workday', 'wsp|wd3|WSPUSA', '{civil}', '{US}', 'https://wsp.wd3.myworkdayjobs.com/WSPUSA'),
  ('HDR', 'workday', 'hdr|wd1|HDR_Careers', '{civil}', '{US}', 'https://hdr.wd1.myworkdayjobs.com/HDR_Careers'),
  ('Stantec', 'workday', 'stantec|wd3|Stantec', '{civil}', '{US}', 'https://stantec.wd3.myworkdayjobs.com/Stantec'),
  ('Turner Construction', 'workday', 'turnerconstruction|wd1|TurnerConstructionCompany', '{civil,construction}', '{US}', 'https://turnerconstruction.wd1.myworkdayjobs.com/TurnerConstructionCompany'),
  ('Skanska USA', 'workday', 'skanska|wd1|SkanskaUSA', '{civil,construction}', '{US}', 'https://skanska.wd1.myworkdayjobs.com/SkanskaUSA'),
  ('Terracon', 'smartrecruiters', 'Terracon', '{civil}', '{US}', 'https://careers.terracon.com'),
  ('Langan', 'greenhouse', 'langan', '{civil}', '{US}', 'https://boards.greenhouse.io/langan'),
  ('Thornton Tomasetti', 'greenhouse', 'thorntontomasetti', '{civil,structural}', '{US}', 'https://boards.greenhouse.io/thorntontomasetti'),
  ('Bowman Consulting', 'greenhouse', 'bowman', '{civil}', '{US}', 'https://boards.greenhouse.io/bowman'),
  ('Atwell', 'greenhouse', 'atwell', '{civil}', '{US}', 'https://boards.greenhouse.io/atwell'),
  ('Milhouse Engineering', 'lever', 'milhouseinc', '{civil}', '{IL,US}', 'https://jobs.lever.co/milhouseinc'),
  -- IT / infrastructure / security
  ('CDW', 'workday', 'cdw|wd1|External', '{it-infra,it-support}', '{US}', 'https://cdw.wd1.myworkdayjobs.com/External'),
  ('Rackspace', 'greenhouse', 'rackspace', '{it-infra,cloud}', '{US}', 'https://boards.greenhouse.io/rackspace'),
  ('Insight Enterprises', 'workday', 'insight|wd1|Insight', '{it-infra}', '{US}', 'https://insight.wd1.myworkdayjobs.com/Insight'),
  ('TEKsystems', 'workday', 'teksystems|wd1|TEKsystems', '{it-infra,it-support,devops}', '{US}', 'https://teksystems.wd1.myworkdayjobs.com/TEKsystems'),
  ('Insight Global', 'smartrecruiters', 'InsightGlobal', '{it-infra,it-support}', '{US}', 'https://jobs.smartrecruiters.com/InsightGlobal'),
  ('Arctic Wolf', 'greenhouse', 'arcticwolf', '{security}', '{US}', 'https://boards.greenhouse.io/arcticwolf'),
  ('Huntress', 'greenhouse', 'huntress', '{security}', '{US}', 'https://boards.greenhouse.io/huntress'),
  ('Cloudflare', 'greenhouse', 'cloudflare', '{security,cloud,devops}', '{US}', 'https://boards.greenhouse.io/cloudflare'),
  ('Datadog', 'greenhouse', 'datadog', '{devops,cloud}', '{US}', 'https://boards.greenhouse.io/datadog'),
  ('HashiCorp', 'greenhouse', 'hashicorp', '{devops,cloud}', '{US}', 'https://boards.greenhouse.io/hashicorp'),
  ('Lightspeed', 'lever', 'lightspeedhq', '{dev,it-support}', '{US}', 'https://jobs.lever.co/lightspeedhq'),
  ('Ramp', 'ashby', 'ramp', '{dev,data}', '{US}', 'https://jobs.ashbyhq.com/ramp'),
  ('Notion', 'ashby', 'notion', '{dev,data}', '{US}', 'https://jobs.ashbyhq.com/notion')
on conflict (ats, token) do nothing;
