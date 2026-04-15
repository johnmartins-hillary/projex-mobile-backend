INSERT INTO advertisements (title, description, image_url, link_url, placement, advertiser_name, advertiser_contact, amount_paid, starts_at, ends_at, is_active) VALUES

-- MARKETPLACE BANNERS (top of marketplace screen)
(
  'Dangote Cement — Build Strong, Build Right',
  'Get the best price on Dangote cement delivered to your site anywhere in Nigeria',
  'https://res.cloudinary.com/dztnevagf/image/upload/v1/ads/dangote-banner.jpg',
  'https://dangotecement.com',
  'MARKETPLACE_BANNER',
  'Dangote Cement PLC',
  'marketing@dangote.com',
  500000,
  NOW(),
  NOW() + INTERVAL '30 days',
  TRUE
),
(
  'BUA Cement — Premium Quality, Unbeatable Price',
  'BUA Cement now available for direct purchase across all Projex suppliers',
  'https://res.cloudinary.com/dztnevagf/image/upload/v1/ads/bua-banner.jpg',
  'https://buacement.com',
  'MARKETPLACE_BANNER',
  'BUA Cement',
  'info@buacement.com',
  450000,
  NOW(),
  NOW() + INTERVAL '30 days',
  TRUE
),

-- MARKETPLACE FEED ADS (between product listings)
(
  'Paystack for Business — Accept Payments Instantly',
  'Join over 200,000 Nigerian businesses using Paystack. Start free today.',
  'https://res.cloudinary.com/dztnevagf/image/upload/v1/ads/paystack-feed.jpg',
  'https://paystack.com',
  'MARKETPLACE_FEED',
  'Paystack',
  'business@paystack.com',
  300000,
  NOW(),
  NOW() + INTERVAL '60 days',
  TRUE
),
(
  'Access Bank Construction Finance',
  'Get up to ₦50M construction loan at competitive rates. Apply in 24 hours.',
  'https://res.cloudinary.com/dztnevagf/image/upload/v1/ads/access-bank-feed.jpg',
  'https://accessbankplc.com',
  'MARKETPLACE_FEED',
  'Access Bank PLC',
  'businessloans@accessbankplc.com',
  400000,
  NOW(),
  NOW() + INTERVAL '45 days',
  TRUE
),
(
  'Lafarge Cement — Stronger Foundations',
  'Lafarge Supaset and Elephant cement for all your construction needs',
  'https://res.cloudinary.com/dztnevagf/image/upload/v1/ads/lafarge-feed.jpg',
  'https://lafarge.com.ng',
  'MARKETPLACE_FEED',
  'Lafarge Africa PLC',
  'marketing@lafarge.com.ng',
  350000,
  NOW(),
  NOW() + INTERVAL '30 days',
  TRUE
),

-- DASHBOARD BANNERS (shown on company app dashboard)
(
  'Sterling Bank — SME Construction Loans',
  'Build your dream project with Sterling Bank SME finance. Low interest rates.',
  'https://res.cloudinary.com/dztnevagf/image/upload/v1/ads/sterling-dashboard.jpg',
  'https://sterlingbank.com',
  'DASHBOARD_BANNER',
  'Sterling Bank',
  'sme@sterlingbank.com',
  280000,
  NOW(),
  NOW() + INTERVAL '30 days',
  TRUE
),
(
  'Projex Pro — Unlock AI Features Today',
  'Upgrade to Projex Pro and get AI cost prediction, unlimited projects and priority support',
  'https://res.cloudinary.com/dztnevagf/image/upload/v1/ads/projex-pro-dashboard.jpg',
  'https://projex.ng/upgrade',
  'DASHBOARD_BANNER',
  'Projex',
  'admin@projex.ng',
  0,
  NOW(),
  NOW() + INTERVAL '365 days',
  TRUE
),
(
  'Julius Berger — Nigeria''s Construction Leaders',
  'Partner with Julius Berger for large scale construction and infrastructure projects',
  'https://res.cloudinary.com/dztnevagf/image/upload/v1/ads/julius-berger-dashboard.jpg',
  'https://julius-berger.com',
  'DASHBOARD_BANNER',
  'Julius Berger Nigeria PLC',
  'info@julius-berger.com',
  600000,
  NOW(),
  NOW() + INTERVAL '90 days',
  TRUE
);