-- ============================================================
-- VigilanteVanguard — Seed Data
-- Karnataka State Police Real Reference Data
-- ============================================================

-- State
INSERT INTO State (StateName, NationalityID, Active) VALUES ('Karnataka', 1, 1);

-- Districts (all 38 units from KSP Monthly Crime Review)
INSERT INTO District (DistrictName, StateID, Active) VALUES
('Bagalkot', 1, 1),
('Ballari', 1, 1),
('Belagavi City', 1, 1),
('Belagavi District', 1, 1),
('Bengaluru City', 1, 1),
('Bengaluru District', 1, 1),
('Bengaluru South', 1, 1),
('Bidar', 1, 1),
('Chamarajanagar', 1, 1),
('Chickballapura', 1, 1),
('Chikkamagaluru', 1, 1),
('Chitradurga', 1, 1),
('Dakshina Kannada', 1, 1),
('Davanagere', 1, 1),
('Dharwad', 1, 1),
('Gadag', 1, 1),
('Hassan', 1, 1),
('Haveri', 1, 1),
('Hubballi Dharwad City', 1, 1),
('K.G.F', 1, 1),
('Kalaburagi', 1, 1),
('Kalaburagi City', 1, 1),
('Karnataka Railways', 1, 1),
('Kodagu', 1, 1),
('Kolar', 1, 1),
('Koppal', 1, 1),
('Mandya', 1, 1),
('Mangaluru City', 1, 1),
('Mysuru City', 1, 1),
('Mysuru District', 1, 1),
('Raichur', 1, 1),
('Shivamogga', 1, 1),
('Tumakuru', 1, 1),
('Udupi', 1, 1),
('Uttara Kannada', 1, 1),
('Vijayanagara', 1, 1),
('Vijayapur', 1, 1),
('Yadgir', 1, 1);

-- Unit Types
INSERT INTO UnitType (UnitTypeName, CityDistState, Hierarchy, Active) VALUES
('Police Station', 'District', 5, 1),
('Circle Office', 'District', 4, 1),
('Sub-Division', 'District', 3, 1),
('District SP Office', 'District', 2, 1),
('Commissionerate', 'City', 2, 1),
('Range DIG Office', 'State', 1, 1),
('State HQ', 'State', 0, 1),
('Railway Police', 'State', 3, 1);

-- Case Categories
INSERT INTO CaseCategory (LookupValue, CategoryCode) VALUES
('FIR', '1'),
('UDR', '3'),
('PAR', '4'),
('Zero FIR', '8'),
('CN', '5');

-- Gravity Offences
INSERT INTO GravityOffence (LookupValue) VALUES
('Heinous'),
('Non-Heinous'),
('Property Related'),
('Person Related');

-- Case Statuses
INSERT INTO CaseStatusMaster (CaseStatusName) VALUES
('Under Investigation'),
('Charge Sheeted'),
('Undetected'),
('False Case'),
('Closed'),
('Referred to Court'),
('Pending Trial'),
('Convicted'),
('Acquitted');

-- Acts
INSERT INTO Act (ActCode, ActDescription, ShortName, Active) VALUES
('IPC',    'Indian Penal Code, 1860', 'IPC', 1),
('BNS',    'Bharatiya Nyaya Sanhita, 2023', 'BNS', 1),
('CRPC',   'Code of Criminal Procedure, 1973', 'CrPC', 1),
('BNSS',   'Bharatiya Nagarik Suraksha Sanhita, 2023', 'BNSS', 1),
('POCSO',  'Protection of Children from Sexual Offences Act, 2012', 'POCSO', 1),
('NDPS',   'Narcotic Drugs and Psychotropic Substances Act, 1985', 'NDPS', 1),
('SCST',   'Scheduled Castes and Scheduled Tribes (Prevention of Atrocities) Act, 1989', 'SC-ST POA', 1),
('IT',     'Information Technology Act, 2000', 'IT Act', 1),
('MV',     'Motor Vehicles Act, 1988', 'MV Act', 1),
('MMDR',   'Mines and Minerals (Development and Regulation) Act, 1957', 'MMDR', 1),
('KMMCR',  'Karnataka Minor Mineral Concession Rules, 1994', 'KMMCR', 1),
('ARMS',   'Arms Act, 1959', 'Arms Act', 1),
('EXCISE', 'Karnataka Excise Act, 1965', 'Excise Act', 1),
('COTPA',  'Cigarettes and Other Tobacco Products Act, 2003', 'COTPA', 1),
('PWD',    'Prevention of Damage to Public Property Act, 1984', 'PDPP', 1);

-- IPC/BNS Key Sections
INSERT INTO Section (ActCode, SectionCode, SectionDescription, Active) VALUES
('IPC', '302', 'Murder', 1),
('IPC', '303', 'Punishment for murder by life-convict', 1),
('IPC', '304', 'Culpable homicide not amounting to murder', 1),
('IPC', '304A', 'Causing death by negligence', 1),
('IPC', '304B', 'Dowry death', 1),
('IPC', '307', 'Attempt to murder', 1),
('IPC', '308', 'Attempt to commit culpable homicide', 1),
('IPC', '312', 'Causing miscarriage', 1),
('IPC', '323', 'Punishment for voluntarily causing hurt', 1),
('IPC', '326A', 'Voluntarily causing grievous hurt by use of acid', 1),
('IPC', '354', 'Assault or criminal force to woman with intent to outrage her modesty', 1),
('IPC', '376', 'Punishment for rape', 1),
('IPC', '379', 'Punishment for theft', 1),
('IPC', '380', 'Theft in dwelling house', 1),
('IPC', '392', 'Punishment for robbery', 1),
('IPC', '395', 'Punishment for dacoity', 1),
('IPC', '406', 'Punishment for criminal breach of trust', 1),
('IPC', '417', 'Punishment for cheating', 1),
('IPC', '420', 'Cheating and dishonestly inducing delivery of property', 1),
('IPC', '447', 'Punishment for criminal trespass', 1),
('IPC', '465', 'Punishment for forgery', 1),
('IPC', '498A', 'Husband or relative of husband of a woman subjecting her to cruelty', 1),
('BNS', '103', 'Murder', 1),
('BNS', '104', 'Punishment for murder by life-convict', 1),
('BNS', '105', 'Culpable homicide not amounting to murder', 1),
('BNS', '106', 'Causing death by negligence', 1),
('BNS', '109', 'Attempt to murder', 1),
('BNS', '64', 'Punishment for rape', 1),
('BNS', '80', 'Dowry death', 1),
('BNS', '85', 'Husband or relative of husband of woman subjecting her to cruelty', 1);

-- Crime Major Heads
INSERT INTO CrimeHead (CrimeGroupName, Active) VALUES
('Crimes Against Body', 1),
('Crimes Against Property', 1),
('Crimes Against Women', 1),
('Crimes Against Children', 1),
('Crimes Against SC/ST', 1),
('Cyber Crimes', 1),
('Economic Offences', 1),
('Special & Local Laws', 1),
('Traffic & Road Accidents', 1),
('Public Order', 1),
('Crimes Against State', 1),
('Narcotics', 1);

-- Crime Sub Heads
INSERT INTO CrimeSubHead (CrimeHeadID, CrimeHeadName, SeqID) VALUES
(1, 'Murder', 1),
(1, 'Attempt to Murder', 2),
(1, 'Culpable Homicide Not Amounting to Murder', 3),
(1, 'Hurt', 4),
(1, 'Grievous Hurt', 5),
(1, 'Acid Attack', 6),
(1, 'Dowry Death', 7),
(2, 'Dacoity', 1),
(2, 'Robbery', 2),
(2, 'Chain Snatching', 3),
(2, 'Burglary (Night)', 4),
(2, 'Burglary (Day)', 5),
(2, 'Theft', 6),
(2, 'Motor Vehicle Theft', 7),
(2, 'House Theft', 8),
(2, 'Criminal Breach of Trust', 9),
(2, 'Cheating', 10),
(2, 'Counterfeiting', 11),
(2, 'Forgery', 12),
(3, 'Rape', 1),
(3, 'Molestation', 2),
(3, 'Cruelty by Husband', 3),
(3, 'Dowry Death', 4),
(3, 'Kidnapping of Women', 5),
(3, 'Sexual Intercourse by Deceitful Means', 6),
(4, 'POCSO', 1),
(4, 'Kidnapping of Children', 2),
(4, 'Missing Children', 3),
(6, 'Cyber Crime (IT Act)', 1),
(7, 'Criminal Breach of Trust', 1),
(7, 'Cheating', 2),
(7, 'Counterfeiting', 3),
(8, 'NDPS Cases', 1),
(8, 'SC/ST POA Act', 2),
(8, 'Preventive Action Report (107 CrPC/126 BNSS)', 3),
(8, 'Preventive Action Report (109 CrPC/128 BNSS)', 4),
(8, 'Preventive Action Report (110 CrPC/129 BNSS)', 5),
(8, 'MMDR Act', 6),
(8, 'KMMCR', 7),
(9, 'Motor Vehicle Accident - Fatal', 1),
(9, 'Motor Vehicle Accident - Non-Fatal', 2),
(10, 'Riots', 1),
(10, 'Affray', 2),
(10, 'Arson', 3);

-- Rank Reference
INSERT INTO Rank (RankName, Hierarchy, Active) VALUES
('DGP', 1, 1),
('ADGP', 2, 1),
('IGP', 3, 1),
('DIG', 4, 1),
('SP', 5, 1),
('ASP', 6, 1),
('DSP', 7, 1),
('PI (Inspector)', 8, 1),
('PSI (Sub-Inspector)', 9, 1),
('ASI', 10, 1),
('HC (Head Constable)', 11, 1),
('PC (Police Constable)', 12, 1);

-- Designation Reference
INSERT INTO Designation (DesignationName, Active, SortOrder) VALUES
('Investigating Officer', 1, 1),
('SHO (Station House Officer)', 1, 2),
('Circle Inspector', 1, 3),
('Sub-Divisional Officer', 1, 4),
('Superintendent of Police', 1, 5),
('DIG', 1, 6),
('IGP', 1, 7);

-- Occupation Master
INSERT INTO OccupationMaster (OccupationName) VALUES
('Farmer'), ('Government Employee'), ('Private Employee'),
('Business'), ('Student'), ('Labourer'), ('Driver'),
('Homemaker'), ('Retired'), ('Self-Employed'), ('Professional'),
('Unemployed'), ('Other');

-- Religion Master
INSERT INTO ReligionMaster (ReligionName) VALUES
('Hindu'), ('Muslim'), ('Christian'), ('Jain'), ('Buddhist'), ('Sikh'), ('Other');

-- ─────────────────────────────────────────────────────────────
-- MONTHLY CRIME STATISTICS SEED (Jan–Jun 2026 from KSP Reports)
-- These are imported from the official CCTNS data PDFs
-- ─────────────────────────────────────────────────────────────

-- January 2026 State Totals
INSERT INTO MonthlyCrimeStat (Month, Year, UnitID, CrimeHeadCode, CaseCount, Source) VALUES
(1, 2026, 5,  'MURDER_TOTAL', 98, 'KSP_PDF'),
(1, 2026, 5,  'DACOITY', 6, 'KSP_PDF'),
(1, 2026, 5,  'ROBBERY', 63, 'KSP_PDF'),
(1, 2026, 5,  'CHAIN_SNATCHING', 29, 'KSP_PDF'),
(1, 2026, 5,  'BURGLARY_NIGHT', 356, 'KSP_PDF'),
(1, 2026, 5,  'BURGLARY_DAY', 85, 'KSP_PDF'),
(1, 2026, 5,  'THEFT', 1742, 'KSP_PDF'),
(1, 2026, 5,  'RIOTS', 319, 'KSP_PDF'),
(1, 2026, 5,  'HURT', 1437, 'KSP_PDF'),
(1, 2026, 5,  'SPL_LOCAL_LAWS', 5857, 'KSP_PDF'),
(1, 2026, 5,  'RAPE', 45, 'KSP_PDF'),
(1, 2026, 5,  'DOWRY_DEATH', 11, 'KSP_PDF'),
(1, 2026, 5,  'POCSO', 316, 'KSP_PDF'),
(1, 2026, 5,  'SCST_POA', 223, 'KSP_PDF'),
(1, 2026, 5,  'CYBER_CRIME', 1259, 'KSP_PDF'),
(1, 2026, 5,  'ECONOMIC_OFFENCES', 470, 'KSP_PDF'),
(1, 2026, 5,  'MOTOR_VEHICLE_THEFT', 767, 'KSP_PDF'),
(1, 2026, 5,  'NDPS', 1397, 'KSP_PDF'),
(1, 2026, 5,  'PAR_107', 1361, 'KSP_PDF'),
(1, 2026, 5,  'PAR_109', 257, 'KSP_PDF'),
(1, 2026, 5,  'PAR_110', 712, 'KSP_PDF'),

-- February 2026 State Totals
(2, 2026, 5,  'MURDER_TOTAL', 73, 'KSP_PDF'),
(2, 2026, 5,  'DACOITY', 14, 'KSP_PDF'),
(2, 2026, 5,  'ROBBERY', 86, 'KSP_PDF'),
(2, 2026, 5,  'CHAIN_SNATCHING', 33, 'KSP_PDF'),
(2, 2026, 5,  'BURGLARY_NIGHT', 291, 'KSP_PDF'),
(2, 2026, 5,  'BURGLARY_DAY', 89, 'KSP_PDF'),
(2, 2026, 5,  'THEFT', 1637, 'KSP_PDF'),
(2, 2026, 5,  'RIOTS', 268, 'KSP_PDF'),
(2, 2026, 5,  'HURT', 1418, 'KSP_PDF'),
(2, 2026, 5,  'SPL_LOCAL_LAWS', 5304, 'KSP_PDF'),
(2, 2026, 5,  'RAPE', 41, 'KSP_PDF'),
(2, 2026, 5,  'DOWRY_DEATH', 5, 'KSP_PDF'),
(2, 2026, 5,  'POCSO', 341, 'KSP_PDF'),
(2, 2026, 5,  'SCST_POA', 203, 'KSP_PDF'),
(2, 2026, 5,  'CYBER_CRIME', 1028, 'KSP_PDF'),
(2, 2026, 5,  'ECONOMIC_OFFENCES', 633, 'KSP_PDF'),
(2, 2026, 5,  'MOTOR_VEHICLE_THEFT', 683, 'KSP_PDF'),
(2, 2026, 5,  'NDPS', 980, 'KSP_PDF'),
(2, 2026, 5,  'PAR_107', 1522, 'KSP_PDF'),
(2, 2026, 5,  'PAR_109', 272, 'KSP_PDF'),
(2, 2026, 5,  'PAR_110', 1361, 'KSP_PDF'),

-- March 2026 State Totals
(3, 2026, 5,  'MURDER_TOTAL', 104, 'KSP_PDF'),
(3, 2026, 5,  'DACOITY', 18, 'KSP_PDF'),

-- April 2026 State Totals
(4, 2026, 5,  'MURDER_TOTAL', 78, 'KSP_PDF'),
(4, 2026, 5,  'DACOITY', 7, 'KSP_PDF'),

-- May 2026 State Totals
(5, 2026, 5,  'MURDER_TOTAL', 94, 'KSP_PDF'),
(5, 2026, 5,  'DACOITY', 15, 'KSP_PDF'),

-- June 2026 State Totals
(6, 2026, 5,  'MURDER_TOTAL', 113, 'KSP_PDF'),
(6, 2026, 5,  'DACOITY', 16, 'KSP_PDF');
