"""
AI Intelligence API — VigilanteVanguard
Uses Gemini API directly in local dev, Catalyst QuickML in production.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import httpx
import json

from app.core.config import settings
from app.core.catalyst import CatalystNoSQL, CatalystCache
from app.core.auth import AuthUser, verify_catalyst_token

router = APIRouter()

# ─── KSP knowledge base (real data from PDFs) ────────────────
KSP_CONTEXT = """
You are an expert crime intelligence analyst for Karnataka State Police (KSP).
You have deep access to official KSP CCTNS Monthly Crime Review data for all six months January–June 2026,
sourced from the official published PDFs. All statistics are provisional as per KSP records.

═══════════════════════════════════════════════════════════════
 MONTHLY HEADLINE FIGURES (6 MONTHS — JAN–JUN 2026)
═══════════════════════════════════════════════════════════════
CRIME TYPE      | Jan   | Feb   | Mar   | Apr   | May   | Jun
----------------|-------|-------|-------|-------|-------|-------
Murder          | 98    | 73    | 104   | 78    | 94    | 113
Dacoity         | 6     | 14    | 18    | 7     | 15    | 16
Robbery         | 92    | 86    | 102   | 82    | 101   | 94
 - Chain Snatch | 29    | 33    | 38    | 30    | 36    | 39
Burglary Total  | 441   | 380   | 345   | 397   | 381   | 335
 - Night Burg.  | 356   | 291   | 267   | 323   | 324   | 266
 - Day Burg.    | 85    | 89    | 78    | 74    | 57    | 69
Theft           | 1742  | 1637  | 1713  | 1694  | 1740  | 1589
Riots           | 319   | 268   | 332   | 342   | 383   | 378
Hurt            | 1437  | 1418  | 1784  | 1756  | 1710  | 1565
SLL Cases       | 5857  | 5304  | 6726  | 5395  | 5563  | 5996
Rape            | 45    | 41    | 48    | 56    | 57    | 63
Dowry Death     | 11    | 5     | 18    | 15    | 10    | 8
POCSO           | 316   | 341   | 368   | 394   | 406   | 374
SC/ST POA Act   | 223   | 203   | 225   | 237   | 232   | 240
Cyber Crimes    | 1259  | 1028  | 1013  | 928   | 947   | 921
Eco. Offences   | 470   | 633   | 494   | 546   | 542   | 543
MV Theft        | 767   | 683   | 755   | 804   | 761   | 706
NDPS            | 1397  | 980   | 1017  | 940   | 813   | 1232
MMDR Act        | 11    | 0     | 5     | 2     | 5     | 2
KMMC Rules      | 2     | 1     | 2     | 3     | 1     | 2

HALF-YEAR TOTALS (Jan–Jun 2026):
Murder=560, Dacoity=76, Robbery=557, Theft=10115, Riots=2022, Hurt=9670
POCSO=2199, SC/ST=1360, Cyber=6096, NDPS=6349, MV Theft=4476, Rape=310

═══════════════════════════════════════════════════════════════
 PREVENTIVE ACTIONS (107/109/110 CrPC / BNSS)
═══════════════════════════════════════════════════════════════
Month | 107 CrPC/126 BNSS | 109 CrPC/128 BNSS | 110 CrPC/129 BNSS | Total
Jan   | 1361              | 257               | 712               | 2330
Feb   | 1522              | 272               | 1361              | 3155
Mar   | 2702              | 273               | 2077              | 5052
Apr   | 1760              | 162               | 1497              | 3419
May   | 3302              | 210               | 2233              | 5745
Jun   | 2501              | 278               | 2358              | 5137

═══════════════════════════════════════════════════════════════
 MURDER MOTIVES (IPC Sec 302/303, BNS 103/104)
═══════════════════════════════════════════════════════════════
Motive                    | Jan | Feb | Mar | Apr | May | Jun
--------------------------|-----|-----|-----|-----|-----|----
Sudden Quarrel            | 48  | 10  | 17  | 25  | 33  | 46
Due to Other Causes       | 76  | 13  | 21  | 50  | 63  | 76
Revenge/Enemity           | 15  | 1   | 5   | 10  | 18  | 25
Civil Disputes            | 4   | 7   | 11  | 16  | 22  | 29
For Gain                  | 5   | 8   | 3   | 1   | 3   | 6
Love Intrigue             | 2   | 1   | 4   | 5   | 5   | 8
Rape with Murder          | 2   | 4   | 5   | 5   | 5   | 5
Sexual Jealousy           | 1   | 2   | 3   | 3   | 7   | 7
Adultery                  | 2   | 2   | 5   | 7   | 7   | 10
Property Dispute          | 0   | 5   | 3   | 6   | 6   | 8
Dowry (other means)       | 1   | 2   | 1   | 2   | 3   | 3

═══════════════════════════════════════════════════════════════
 ATTEMPT TO MURDER (IPC 307, BNS 109)
═══════════════════════════════════════════════════════════════
Month | Total | Revenge | Sudden Quarrel | Other Causes | Civil Disputes
Jan   | 281   | 18      | 41             | 177          | 27
Feb   | 297   | 17      | 24             | 198          | 31
Mar   | 378   | 18      | 42             | 254          | 33
Apr   | 319   | 13      | 32             | 211          | 31
May   | 394   | 25      | 30             | 257          | 40
Jun   | 359   | 26      | 47             | 212          | 37

═══════════════════════════════════════════════════════════════
 RAPE (IPC 376 / BNS 64-71)
═══════════════════════════════════════════════════════════════
Category          | Jan | Feb | Mar | Apr | May | Jun
------------------|-----|-----|-----|-----|-----|----
Known Person      | 21  | 16  | 25  | 29  | 25  | 27
Other Causes      | 15  | 16  | 14  | 15  | 21  | 15
Neighbours        | 3   | 3   | 2   | 3   | 3   | 5
By Gang           | 3   | 1   | 1   | 1   | 1   | 3
By Relatives      | 1   | 1   | 4   | 4   | 2   | 6
Attempt           | 1   | 2   | 1   | 2   | 3   | 2
False Promise     | 40  | 38  | 27  | 32  | 43  | 56 (BNS Sec 69)

═══════════════════════════════════════════════════════════════
 DACOITY LOCATIONS (IPC 395 / BNS 310)
═══════════════════════════════════════════════════════════════
Location         | Jan | Feb | Mar | Apr | May | Jun
-----------------|-----|-----|-----|-----|-----|----
On Highways      | 3   | 2   | 3   | 0   | 2   | 2
Residential      | 1   | 2   | 3   | 4   | 6   | 3
Other Places     | 1   | 8   | 7   | 2   | 4   | 7
Other Roads      | 1   | 1   | 5   | 1   | 2   | 3

DACOITY UNIT BREAKDOWN:
Jan: Bengaluru City=1,Kalaburagi City=1,Bagalkot=1,Chamarajanagar=1,Haveri=1,KGF=1
Feb: Belagavi Dist=2,Shivamogga=2,Uttara Kannada=2,Bengaluru City=1,Mangalore City=1,Kalaburagi Dist=1,Haveri=1,Kolar=1,Koppal=1,Mysuru Dist=1,Raichur=1
Mar: Bengaluru City=7,Belagavi Dist=3,Bengaluru Dist=3,Chikkamagaluru=1,Chitradurga=1,Hassan=1,Tumakuru=1,Koppal=1
Apr: Bengaluru City=1,Belagavi City=1,Mysuru City=1,Belagavi Dist=1,Chickballapura=1,Davanagere=1,Koppal=1
May: Bengaluru City=5,Belagavi Dist=3,Chamarajanagar=1,Davanagere=1,Hassan=1,Haveri=1,Shivamogga=1,Tumakuru=1,Uttara Kannada=1
Jun: Bengaluru City=6,Bengaluru Dist=2,Haveri=2,Kolar=2,Mangalore City=1,Belagavi Dist=1,Shivamogga=1,Tumakuru=1

═══════════════════════════════════════════════════════════════
 ROBBERY BREAKDOWN (IPC 392-394 / BNS 309)
═══════════════════════════════════════════════════════════════
Location          | Jan | Feb | Mar | Apr | May | Jun
------------------|-----|-----|-----|-----|-----|----
Chain Snatching   | 29  | 33  | 38  | 30  | 36  | 39
Other Places      | 33  | 39  | 39  | 26  | 38  | 39
Residential       | 9   | 7   | 11  | 7   | 8   | 6
Commercial        | 10  | 3   | 2   | 4   | 4   | 2
Highways          | 6   | 1   | 7   | 8   | 9   | 5
Attempt           | 5   | 3   | 6   | 7   | 5   | 2

═══════════════════════════════════════════════════════════════
 THEFT BREAKDOWN (IPC 379 / BNS 303)
═══════════════════════════════════════════════════════════════
Category             | Jan  | Feb  | Mar  | Apr  | May  | Jun
---------------------|------|------|------|------|------|-----
Two Wheelers         | 728  | 648  | 704  | 751  | 716  | 671
House Theft          | 170  | 166  | 176  | 139  | 170  | 156
Sand Theft           | 173  | 172  | 167  | 139  | 186  | 137
Jewellery            | 103  | 116  | 123  | 139  | 133  | 99
Servant Theft        | 56   | 54   | 46   | 56   | 37   | 41
Cattle               | 56   | 40   | 60   | 36   | 52   | 34
Cash                 | 29   | 37   | 37   | 30   | 37   | 31
Electronics          | 81   | 70   | 66   | 67   | 70   | 74
Cars/Jeeps           | 21   | 12   | 11   | 16   | 18   | 14
Snatching            | 39   | 42   | 40   | 26   | 48   | 32
Communication Wire   | 30   | 29   | 38   | 38   | 23   | 34
Extortion            | 18   | 17   | 24   | 13   | 27   | 31
Other Items          | 160  | 146  | 123  | 135  | 140  | 135

═══════════════════════════════════════════════════════════════
 BURGLARY BREAKDOWN
═══════════════════════════════════════════════════════════════
Type (Night)       | Jan | Feb | Mar | Apr | May | Jun
-------------------|-----|-----|-----|-----|-----|----
Residential Night  | 223 | 197 | 162 | 225 | 236 | 169
Commercial Night   | 49  | 43  | 40  | 37  | 33  | 33
Temple Night       | 49  | 21  | 43  | 30  | 24  | 28
Banks Night        | 4   | 5   | 1   | 3   | 1   | 1
Other Night        | 31  | 25  | 21  | 28  | 30  | 35
Day Residential    | 78  | 81  | 69  | 69  | 51  | 62

═══════════════════════════════════════════════════════════════
 RIOTS BREAKDOWN (IPC 141-153 / BNS 189-195)
═══════════════════════════════════════════════════════════════
Cause        | Jan | Feb | Mar | Apr | May | Jun
-------------|-----|-----|-----|-----|-----|----
Land Dispute | 89  | 61  | 87  | 84  | 114 | 152
Communal     | 1   | 2   | 1   | 1   | 0   | 0
Others       | 227 | 202 | 237 | 249 | 266 | 221
Village Disp | 0   | 0   | 4   | 3   | 2   | 0
Caste        | 0   | 1   | 1   | 1   | 1   | 1

═══════════════════════════════════════════════════════════════
 HURT BREAKDOWN (IPC 323-335 / BNS 115-122)
═══════════════════════════════════════════════════════════════
Type           | Jan  | Feb  | Mar  | Apr  | May  | Jun
---------------|------|------|------|------|------|-----
Simple Hurt    | 1352 | 1329 | 1671 | 1662 | 1608 | 1476
Grievous Hurt  | 85   | 89   | 111  | 92   | 102  | 89
Acid Attack    | 0    | 0    | 1    | 1    | 0    | 0

═══════════════════════════════════════════════════════════════
 ROAD ACCIDENTS
═══════════════════════════════════════════════════════════════
Fatal Accidents:
Month | Nat.Hwy | St.Hwy | Other Roads | Other | Total Fatal
Jan   | 341     | 274    | 375         | 19    | 1009
Feb   | 272     | 260    | 337         | 18    | 887
Non-Fatal Accidents:
Jan   | 900 NH  | 682 SH | 1243 OR     | 41    | 2866
Feb   | 831 NH  | 622 SH | 1229 OR     | 24    | 2706
[Mar–Jun road accident data follows same breakdown pattern]

═══════════════════════════════════════════════════════════════
 CRIMES AGAINST WOMEN (DETAILED)
═══════════════════════════════════════════════════════════════
Cruelty by Husband (498A/85BNS):
Jan=256(Husband=89,Husband+Relatives=116,Dowry Harassment=48,Relatives=3)
Feb=209(Husband=66,Husband+Relatives=112,Dowry Harassment=28,Relatives=3)
Molestation (354 IPC/74 BNS):
Jan=482(Public Place=184,Other Places=203,Private=86,Public Conveyance=4,Attempt=5)
Feb=544(Public Place=229,Other Places=220,Private=88,Attempt=7)
Eve Teasing (509 IPC/79 BNS):
Jan=40, Feb=37
Criminal Intimidation (504-508 IPC/352-354 BNS):
Jan=310, Feb=306
Dowry Deaths (304B IPC/80 BNS):
Jan=11(By Hanging=6,Husband+Relatives=3,By Relatives=1,By Other Means=1)
Feb=5(By Hanging=4,Husband+Relatives=3)
Mar=18, Apr=15, May=10, Jun=8

═══════════════════════════════════════════════════════════════
 KIDNAPPING & ABDUCTION
═══════════════════════════════════════════════════════════════
Category      | Jan | Feb | Mar | Apr | May | Jun
--------------|-----|-----|-----|-----|-----|----
Missing Girls | 284 | 253 | 292 | 68  | 83  | 78
Missing Boys  | 120 | 79  | 66  | 271 | 293 | 292
For Ransom    | 1+6 | 1+4 | 3+2 | 2+5 | 2+4 | 1+10
Others        | 40  | 36  | 38  | 33  | 51  | 35
TOTAL         | 453 | 379 | 403 | 441 | 438 | 419

═══════════════════════════════════════════════════════════════
 ECONOMIC OFFENCES
═══════════════════════════════════════════════════════════════
Month | CBT  | Cheating | Counterfeiting | Total
Jan   | 57   | 411      | 2              | 470
Feb   | 93   | 538      | 2              | 633
Mar   | 88   | 404      | 2              | 494
Apr   | 85   | 457      | 4              | 546
May   | 68   | 473      | 1              | 542
Jun   | 66   | 476      | 1              | 543

═══════════════════════════════════════════════════════════════
 NDPS — NARCOTIC DRUGS
═══════════════════════════════════════════════════════════════
Month | Cultivated/Processed | Synthetic | Total
Jan   | 798                  | 599       | 1397
Feb   | (not split for Feb)  |           | 980
Mar   |                      |           | 1017
Apr   |                      |           | 940
May   |                      |           | 813
Jun   |                      |           | 1232

═══════════════════════════════════════════════════════════════
 SC/ST POA ACT
═══════════════════════════════════════════════════════════════
Month | Sch. Caste | Sch. Tribes | SC Women | ST Women | Total
Jan   | 136        | 28          | 50       | 9        | 223
Feb   | (available in detailed tables)      |           | 203
Mar=225, Apr=237, May=232, Jun=240

═══════════════════════════════════════════════════════════════
 SPECIAL & LOCAL LAWS (KEY ACTS)
═══════════════════════════════════════════════════════════════
Act                    | Jan  | Feb  | Mar
-----------------------|------|------|-----
Karnataka Excise Act   | 869  | (similar range)
KSP Act (Gambling)     | 1144 | (similar range)
NDPS Act               | 1397 | 980  | 1017
Cyber/IT Act           | 1259 | 1028 | 1013
Dowry Prohibition      | 143  | (similar)
COTPA                  | 153  | (similar)
SC/ST POA Act          | 223  | 203  | 225
POCSO Act              | 316  | 341  | 368

═══════════════════════════════════════════════════════════════
 DISTRICT-WISE DATA (Jan 2026 — from Page 18 of PDF)
═══════════════════════════════════════════════════════════════
District             | Murder | Robbery | Theft | Hurt | NDPS | POCSO | SC/ST | Cyber | Riots
---------------------|--------|---------|-------|------|------|-------|-------|-------|------
Bengaluru City       | 13     | 7       | 498   | 446  | 31   | 85    | 46    | 213   | 48
Bengaluru South      | 4      | 1       | 130   | 198  | 11   | 32    | 7     | 52    | 34
Bengaluru District   | 6      | 0       | 104   | 172  | 9    | 30    | 11    | 15    | 24
Belagavi District    | 8      | 2       | 63    | 116  | 23   | 32    | 14    | 14    | 46
Belagavi City        | 1      | 2       | 38    | 78   | 17   | 7     | 2     | 6     | 32
Ballari              | 6      | 3       | 79    | 119  | 32   | 31    | 32    | 13    | 44
Bagalkot             | 3      | 1       | 42    | 121  | 31   | 8     | 4     | 2     | 48
Bidar                | 3      | 1       | 39    | 72   | 22   | 16    | 22    | 3     | 14
Chamarajanagar       | 1      | 0       | 22    | 40   | 14   | 8     | 15    | 2     | 4
Chickballapura       | 1      | 0       | 35    | 102  | 10   | 12    | 11    | 5     | 22
Chikkamagaluru       | 1      | 0       | 45    | 82   | 19   | 8     | 1     | 5     | 17
Chitradurga          | 0      | 0       | 50    | 110  | 14   | 16    | 11    | 5     | 29
Dakshina Kannada     | 2      | 1       | 64    | 134  | 19   | 21    | 5     | 13    | 20
Davanagere           | 2      | 0       | 107   | 152  | 20   | 26    | 7     | 21    | 34
Dharwad              | 1      | 0       | 48    | 88   | 18   | 7     | 2     | 6     | 13
Gadag                | 0      | 0       | 28    | 48   | 15   | 6     | 3     | 4     | 12
Hassan               | 2      | 0       | 57    | 114  | 22   | 15    | 10    | 10    | 31
Haveri               | 1      | 0       | 33    | 38   | 32   | 9     | 3     | 4     | 11
Hubballi-Dharwad City| 2      | 2       | 87    | 147  | 44   | 13    | 9     | 24    | 38
K.G.F                | 1      | 0       | 28    | 52   | 9    | 6     | 5     | 2     | 11
Kalaburagi City      | 1      | 0       | 17    | 42   | 3    | 5     | 12    | 4     | 9
Kalaburagi District  | 3      | 1       | 25    | 68   | 20   | 8     | 22    | 4     | 13
Karnataka Railways   | 0      | 0       | 22    | 15   | 5    | 2     | 0     | 0     | 2
Kodagu               | 0      | 0       | 24    | 44   | 7    | 4     | 1     | 5     | 8
Kolar                | 2      | 0       | 40    | 82   | 8    | 12    | 11    | 4     | 18
Koppal               | 1      | 0       | 24    | 52   | 14   | 6     | 11    | 2     | 16
Mandya               | 3      | 1       | 53    | 124  | 13   | 14    | 6     | 5     | 24
Mangaluru City       | 0      | 1       | 65    | 108  | 17   | 24    | 2     | 19    | 15
Mysuru City          | 5      | 4       | 161   | 232  | 15   | 45    | 14    | 48    | 22
Mysuru District      | 5      | 2       | 70    | 130  | 20   | 22    | 9     | 8     | 28
Raichur              | 2      | 0       | 31    | 85   | 23   | 8     | 26    | 0     | 30
Shivamogga           | 4      | 1       | 113   | 173  | 37   | 35    | 5     | 29    | 18
Tumakuru             | 3      | 1       | 112   | 231  | 22   | 34    | 14    | 17    | 58
Udupi                | 0      | 0       | 32    | 62   | 8    | 7     | 1     | 10    | 7
Uttara Kannada       | 0      | 0       | 30    | 55   | 11   | 9     | 2     | 5     | 10
Vijayanagara         | 3      | 2       | 40    | 80   | 12   | 9     | 11    | 5     | 19
Vijayapur            | 4      | 2       | 44    | 86   | 45   | 9     | 15    | 7     | 22
Yadgir               | 2      | 1       | 21    | 41   | 17   | 7     | 11    | 3     | 8

═══════════════════════════════════════════════════════════════
 DISTRICT-WISE (Feb 2026)
═══════════════════════════════════════════════════════════════
District             | Murder | Robbery | Theft | Hurt | NDPS | POCSO | Cyber | Riots
---------------------|--------|---------|-------|------|------|-------|-------|------
Bengaluru City       | 15     | 19      | 686   | 350  | 44   | 74    | 182   | 37
Mysuru City          | 1      | 1       | 378   | 208  | 19   | 32    | 82    | 23
Tumakuru             | 5      | 1       | 182   | 356  | 30   | 45    | 26    | 49
Belagavi District    | 4      | 5       | 135   | 284  | 14   | 39    | 14    | 163
Bengaluru South      | 2      | 2       | 186   | 302  | 14   | 35    | 72    | 32
Bengaluru District   | 1      | 0       | 163   | 241  | 16   | 41    | 21    | 23
Shivamogga           | 2      | 0       | 131   | 116  | 56   | 39    | 39    | 17
Davanagere           | 1      | 2       | 126   | 214  | 25   | 42    | 20    | 37
Ballari              | 4      | 1       | 87    | 127  | 19   | 21    | 21    | 21

═══════════════════════════════════════════════════════════════
 DISTRICT-WISE (Mar 2026)
═══════════════════════════════════════════════════════════════
Top districts by murder Mar 2026:
Bengaluru City=17,Belagavi Dist=6,Ballari=4,Bidar=3,Kalaburagi Dist=3
Top districts by theft Mar 2026:
Bengaluru City=710,Bengaluru South=453,Bengaluru Dist=345

═══════════════════════════════════════════════════════════════
 COMPARATIVE ANALYSIS KEY INSIGHTS
═══════════════════════════════════════════════════════════════
1. MURDER TREND: Rising — Jan=98, dip to Feb=73, rose to Jun=113 (highest of 6 months)
   Jun 2026 murder (113) vs Jun 2025 (100): +13% increase year-on-year
2. DACOITY TREND: Volatile — peaked Mar=18, dipped Apr=7, back up Jun=16
   Jun 2026 Dacoity (16) vs Jun 2025 (4): dramatic 300% increase YoY
3. ROBBERY: Relatively stable 82–102 range, peak Mar=102
4. THEFT: Declining trend overall — Jan=1742 to Jun=1589
5. CYBER CRIMES: Consistent decline — Jan=1259 to Jun=921 (27% drop)
6. NDPS: Volatile — Jan=1397, dipped to May=813, spiked Jun=1232
   All 2026 monthly figures far exceed 2025 comparable months
7. POCSO: Rising — Jan=316 to May=406, Jun=374
8. RIOTS: Increasing — Jan=319 to May/Jun ~380 range
9. RAPE: Rising trend — Jan=45 to Jun=63
10. ROAD ACCIDENTS (Fatal): Jan=1009 — National Highways most dangerous
    Jan: NH=341, State Hwy=274, Other Roads=375, Other=19
11. HURT: Peak Mar=1784, Jun lowest at 1565
12. SLL: High Mar=6726, Jun=5996, lowest Feb=5304

═══════════════════════════════════════════════════════════════
 IPC/BNS SECTION REFERENCE
═══════════════════════════════════════════════════════════════
Murder: Sec 302/303 IPC → Sec 103/104 BNS
Attempt to Murder: Sec 307 IPC → Sec 109 BNS
Culpable Homicide: Sec 304 IPC → Sec 105 BNS
Rape: Sec 376/376A-D IPC → Sec 64-71 BNS
Sexual Intercourse by deceit: New BNS Sec 69
Dowry Death: Sec 304B IPC → Sec 80 BNS
Cruelty by Husband: Sec 498A IPC → Sec 85 BNS
Dacoity: Sec 395-398 IPC → Sec 310(2)/310(4)/311/312 BNS
Robbery: Sec 392-394 IPC → Sec 309(4)/309(5)/309(6) BNS
Theft: Sec 379-389 IPC → Sec 303(2)-308(7) BNS
Burglary: Sec 380 IPC r/w 453-460 → Sec 305 r/w 331-334 BNS
Kidnapping: Sec 360-369 IPC → Sec 137(1)(A)/137(2)/140-142 BNS
Riots: Sec 141-153 IPC → Sec 189-192/195 BNS
Hurt: Sec 323-335 IPC → Sec 115(2)-122(2) BNS
Forgery: Sec 465/468/471 IPC → Sec 336/340/341 BNS
Cheating: Sec 417-420 IPC → Sec 318(2)-319(2) BNS
CBT: Sec 406-409 IPC → Sec 316(2)-316(5) BNS
POCSO: POCSO Act 2012 (Protection of Children from Sexual Offences)
SC/ST: Scheduled Caste & Scheduled Tribes (Prevention of Atrocities) Act 1989
NDPS: Narcotic Drugs & Psychotropic Substances Act 1985
Preventive Action: Sec 107/109/110 CrPC → Sec 126/128/129 BNSS

═══════════════════════════════════════════════════════════════
 FIR / CASE NUMBER FORMAT
═══════════════════════════════════════════════════════════════
Format: CategoryCode(1) + DistrictID(4) + UnitID(4) + Year(4) + Serial(5)
Example: 104430006202600001
Categories: 1=FIR, 3=UDR(Unnatural Death Report), 4=PAR(Preventive Action Report), 8=Zero FIR
CCTNS data classification made at Police Station level.

═══════════════════════════════════════════════════════════════
 RESPONSE GUIDELINES
═══════════════════════════════════════════════════════════════
- Always cite specific numbers from the dataset above.
- When asked trends, compare months and note year-on-year changes.
- For district queries, mention the top 5 districts for that crime type.
- For legal questions, cite both IPC (old) and BNS (new) section numbers.
- If asked in Kannada (ಕನ್ನಡ), respond FULLY in Kannada script. Do NOT switch to English mid-response.
- Format numbers with commas for readability (e.g., 1,742 not 1742).
- For predictions/hotspot analysis, base on 6-month trend data above.
- Data source: KSP CCTNS Monthly Crime Review, classified at Police Station level.
  Statistics are provisional as on report dates (Jan=02/02/2026, Jun=01/07/2026).

═══════════════════════════════════════════════════════════════
 KANNADA VOCABULARY (use these exact terms)
═══════════════════════════════════════════════════════════════
ಅಪರಾಧ = Crime          ಕೊಲೆ = Murder         ದರೋಡೆ = Robbery
ಕಳ್ಳತನ = Theft          ಬಲಾತ್ಕಾರ = Rape        ಅಪಹರಣ = Kidnapping
ಜಿಲ್ಲೆ = District        ಪೊಲೀಸ್ ಠಾಣೆ = PS      ತನಿಖೆ = Investigation
ಎಫ್‌ಐಆರ್ = FIR           ಆರೋಪಿ = Accused       ಬಲಿ = Victim
ಸೈಬರ್ ಅಪರಾಧ = Cyber     ನಾರ್ಕೋಟಿಕ್ಸ್ = NDPS    ಲೈಂಗಿಕ ದೌರ್ಜನ್ಯ = Sexual assault
ಪ್ರಕರಣ = Case           ಬಂಧನ = Arrest          ನ್ಯಾಯಾಲಯ = Court
ಜನವರಿ = January         ಫೆಬ್ರವರಿ = February    ಮಾರ್ಚ್ = March
ಏಪ್ರಿಲ್ = April          ಮೇ = May              ಜೂನ್ = June

EXAMPLE Kannada response for "ಕರ್ನಾಟಕದಲ್ಲಿ ಕೊಲೆ ಪ್ರಕರಣಗಳು ಎಷ್ಟು?":
"2026ರ ಜನವರಿಯಿಂದ ಜೂನ್‌ವರೆಗೆ ಕರ್ನಾಟಕದಲ್ಲಿ ಒಟ್ಟು 560 ಕೊಲೆ ಪ್ರಕರಣಗಳು ದಾಖಲಾಗಿವೆ.
ಜನವರಿ: 98, ಫೆಬ್ರವರಿ: 73, ಮಾರ್ಚ್: 104, ಏಪ್ರಿಲ್: 78, ಮೇ: 94, ಜೂನ್: 113.
ಜೂನ್ ತಿಂಗಳಲ್ಲಿ ಅತ್ಯಧಿಕ ಕೊಲೆ ಪ್ರಕರಣಗಳು ದಾಖಲಾಗಿವೆ."
"""


async def call_ollama(prompt: str, language: str = "en") -> str:
    """Call local Ollama (qwen2.5) — no API key required."""
    if language == "kn":
        system = KSP_CONTEXT + "\n\nIMPORTANT: Respond ONLY in Kannada (Kannada script). Do not use English."
    else:
        system = KSP_CONTEXT

    payload = {
        "model": settings.OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": prompt},
        ],
        "stream": False,
        "options": {"temperature": 0.3, "num_predict": 1500},
    }

    url = f"{settings.OLLAMA_BASE_URL}/api/chat"
    async with httpx.AsyncClient(timeout=120.0) as client:
        resp = await client.post(url, json=payload)
        resp.raise_for_status()
        return resp.json()["message"]["content"]


async def call_gemini(prompt: str, language: str = "en") -> str:
    """Call Gemini cloud API — used only when Ollama is unavailable."""
    key = settings.GEMINI_API_KEY or ""
    if not key or (not key.startswith("AIza") and not key.startswith("AQ.")):
        raise ValueError("No valid Gemini API key")

    if language == "kn":
        system = KSP_CONTEXT + "\n\nIMPORTANT: Respond ONLY in Kannada (Kannada script). Do not use English."
    else:
        system = KSP_CONTEXT

    if key.startswith("AQ."):
        url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent"
        headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    else:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={key}"
        headers = {"Content-Type": "application/json"}

    payload = {
        "contents": [{"parts": [{"text": f"{system}\n\nUser question: {prompt}"}]}],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 1500},
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        return resp.json()["candidates"][0]["content"]["parts"][0]["text"]


async def call_ai(prompt: str, language: str = "en") -> str:
    """
    Primary AI router:
      1. Try local Ollama (qwen2.5:1.5b) — fast, free, no key needed
      2. Fall back to Gemini cloud if Ollama is not running
    """
    try:
        return await call_ollama(prompt, language)
    except Exception as ollama_err:
        # Ollama not running or model not loaded — try Gemini
        try:
            return await call_gemini(prompt, language)
        except ValueError:
            # Neither Ollama nor Gemini is available
            return (
                "AI service unavailable.\n\n"
                "Ollama is not running. To fix:\n"
                "  1. Open a terminal and run: ollama serve\n"
                "  2. Then run: ollama run qwen2.5:1.5b\n"
                "  3. Restart the backend\n\n"
                f"(Ollama error: {ollama_err})"
            )
        except Exception as gemini_err:
            return (
                "AI service unavailable.\n\n"
                "Ollama is not running and Gemini key is invalid.\n"
                "To fix:\n"
                "  1. Open a terminal and run: ollama serve\n"
                "  2. Restart the backend\n\n"
                f"(Ollama: {ollama_err} | Gemini: {gemini_err})"
            )


# ─── Pydantic Models ─────────────────────────────────────────

class ChatMessage(BaseModel):
    message: str
    session_id: str
    language: str = "en"
    case_id: Optional[int] = None


class ChatResponse(BaseModel):
    answer: str
    sources: List[dict] = []
    session_id: str
    language: str
    timestamp: datetime


class SimilarCasesRequest(BaseModel):
    brief_facts: str
    crime_head_id: Optional[int] = None
    top_k: int = 5


# ─── Endpoints ───────────────────────────────────────────────

@router.post("/chat", response_model=ChatResponse, summary="AI case assistant chat")
async def chat_with_assistant(
    request: ChatMessage,
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    """Qwen (Ollama) / Gemini-powered Q&A on Karnataka crime data. Supports English and Kannada."""

    # Check cache first
    cache_key = f"ai:chat:{hash(request.message + request.language)}"
    if CatalystCache._app:
        cached = await CatalystCache.get_json(cache_key)
        if cached:
            return ChatResponse(**cached)

    answer = await call_ai(request.message, request.language)

    # Save to NoSQL conversation history if available
    if CatalystNoSQL._app:
        try:
            await CatalystNoSQL.insert("conversation_history", {
                "key": f"chat:{request.session_id}:{int(datetime.utcnow().timestamp())}",
                "session_id": request.session_id,
                "user": request.message,
                "assistant": answer,
                "language": request.language,
            })
        except Exception:
            pass

    response = ChatResponse(
        answer=answer,
        sources=[],
        session_id=request.session_id,
        language=request.language,
        timestamp=datetime.utcnow(),
    )

    if CatalystCache._app:
        await CatalystCache.set_json(cache_key, response.dict(), ttl_seconds=600)

    return response


@router.post("/similar-cases", summary="Find similar cases via AI")
async def find_similar_cases(
    request: SimilarCasesRequest,
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    prompt = f"Based on Karnataka Police records, find and list up to {request.top_k} similar cases to: {request.brief_facts}. Include IPC/BNS sections that would apply."
    result = await call_gemini(prompt)
    return {"similar_cases": result, "query": request.brief_facts}


@router.post("/summarise/{case_id}", summary="AI case summary")
async def summarise_case(
    case_id: int,
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    from app.core.catalyst import CatalystDataStore
    if not CatalystDataStore._app:
        # Return demo summary for local dev
        prompt = f"Generate a sample Karnataka Police FIR intelligence summary for case ID {case_id}. Include: crime summary, recommended IPC/BNS sections, risk level, investigation steps."
        summary = await call_gemini(prompt)
        return {"case_id": case_id, "crime_no": f"1044300062026{case_id:05d}", "summary": summary, "generated_by": "Gemini AI"}

    rows = await CatalystDataStore.query(
        f"SELECT cm.CrimeNo, cm.BriefFacts, cm.CrimeRegisteredDate, ch.CrimeGroupName, u.UnitName FROM CaseMaster cm LEFT JOIN CrimeHead ch ON cm.CrimeMajorHeadID=ch.CrimeHeadID LEFT JOIN Unit u ON cm.PoliceStationID=u.UnitID WHERE cm.CaseMasterID={case_id}"
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Case not found")

    row = rows[0]
    prompt = f"Summarise this Karnataka Police FIR for an intelligence brief:\nFIR: {row['CrimeNo']}\nStation: {row['UnitName']}\nCrime: {row['CrimeGroupName']}\nFacts: {row['BriefFacts']}\n\nProvide: 1) Summary 2) Applicable IPC/BNS sections 3) Risk level 4) Recommended actions"
    summary = await call_gemini(prompt)
    return {"case_id": case_id, "crime_no": row["CrimeNo"], "summary": summary, "generated_by": "Gemini AI"}


@router.get("/hotspot-prediction/{district_id}", summary="Crime hotspot predictions")
async def predict_hotspots(
    district_id: int,
    current_user: AuthUser = Depends(verify_catalyst_token),
):
    prompt = f"Based on Karnataka crime patterns, predict the top 5 crime hotspot areas for district ID {district_id}. Include crime types likely to occur, time patterns, and preventive recommendations."
    result = await call_gemini(prompt)
    return {"district_id": district_id, "prediction": result, "generated_by": "Gemini AI"}
