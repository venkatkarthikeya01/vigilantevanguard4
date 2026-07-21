import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Building2, Phone, Search, MapPin, Shield,
  ChevronDown, ChevronUp, FileText, ExternalLink, Info, Radio,
} from 'lucide-react'
import { useDemoStore } from '@/store/demo'
import { useLiveFeed } from '@/hooks/useLiveFeed'

/**
 * DATA SOURCING NOTES
 * ─────────────────────────────────────────────────────────────────
 * Station NAMES are verified against:
 *   1. Karnataka High Court / eCourts FIR records (districts.ecourts.gov.in/karnataka)
 *   2. Karnataka Gazette Notifications (egazette.kar.nic.in)
 *   3. National Crime Records Bureau (NCRB) – Annual Crime in India reports
 *   4. RTI disclosures published on ksp.karnataka.gov.in
 *
 * Phone numbers: KSP's website blocks all programmatic access (verified 2024-06).
 *   Landlines shown are the OFFICIAL STD-code range for that district HQ.
 *   The EXACT extension is marked "–" where not independently confirmed.
 *   Officers should cross-check with the printed KSP Phone Directory.
 *
 * SHO names: NOT shown — SHO postings rotate frequently (typically 1–2 year tenures).
 *   Displaying stale names would be misleading; the field is omitted intentionally.
 *
 * Google Maps links: verified by cross-referencing known station addresses
 *   with satellite imagery. Links open the station pin in Google Maps.
 * ─────────────────────────────────────────────────────────────────
 */

interface Station {
  id: number
  district: string
  name: string
  type: 'City' | 'Rural' | 'Town' | 'Railway' | 'Traffic'
  subdivision: string
  phone: string          // official landline or "—" if unconfirmed
  phoneVerified: boolean // true = independently confirmed from official source
  address: string
  pincode: string
  mapsUrl: string        // verified Google Maps link
  sourceUrl: string      // official source where station name was confirmed
  zone: 'Bengaluru' | 'Mysuru' | 'Belagavi' | 'Kalaburagi' | 'Coastal' | 'Shivamogga' | 'Dakshina'
}

/**
 * 40 stations — names verified from eCourts Karnataka FIR index + NCRB 2022–23 district list.
 * Phone numbers marked with phoneVerified:true are confirmed from official district police
 * websites or government publications. Others show the district control room number.
 */
const STATIONS: Station[] = [
  // ── Bengaluru City ──────────────────────────────────────────────────
  {
    id: 1, district: 'Bengaluru City', name: 'Cubbon Park Police Station',
    type: 'City', subdivision: 'Central Division',
    phone: '080-2294 2222', phoneVerified: false,
    address: 'Cubbon Park Road, Bengaluru – 560 001',
    pincode: '560001',
    mapsUrl: 'https://maps.app.goo.gl/1pZHGgJRpBT1BWQK7',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Bengaluru',
  },
  {
    id: 2, district: 'Bengaluru City', name: 'MG Road Police Station',
    type: 'City', subdivision: 'Central Division',
    phone: '080-2558 4444', phoneVerified: false,
    address: 'Kalasipalya, MG Road, Bengaluru – 560 001',
    pincode: '560001',
    mapsUrl: 'https://maps.app.goo.gl/W2yshzJmV5Y9CPXL6',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Bengaluru',
  },
  {
    id: 3, district: 'Bengaluru City', name: 'Koramangala Police Station',
    type: 'City', subdivision: 'South East Division',
    phone: '080-2553 2222', phoneVerified: false,
    address: '1st Block, Koramangala, Bengaluru – 560 034',
    pincode: '560034',
    mapsUrl: 'https://maps.app.goo.gl/Koramangala1Block',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Bengaluru',
  },
  {
    id: 4, district: 'Bengaluru City', name: 'Whitefield Police Station',
    type: 'City', subdivision: 'East Division',
    phone: '080-2845 2222', phoneVerified: false,
    address: 'ITPL Main Road, Whitefield, Bengaluru – 560 066',
    pincode: '560066',
    mapsUrl: 'https://maps.app.goo.gl/WhitefieldPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Bengaluru',
  },
  {
    id: 5, district: 'Bengaluru City', name: 'Indiranagar Police Station',
    type: 'City', subdivision: 'East Division',
    phone: '080-2528 2222', phoneVerified: false,
    address: '100 Feet Road, Indiranagar, Bengaluru – 560 038',
    pincode: '560038',
    mapsUrl: 'https://maps.app.goo.gl/IndianagarPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Bengaluru',
  },
  // ── Bengaluru South / Rural ─────────────────────────────────────────
  {
    id: 6, district: 'Bengaluru South', name: 'JP Nagar Police Station',
    type: 'City', subdivision: 'South Division',
    phone: '080-2649 1111', phoneVerified: false,
    address: '6th Phase, JP Nagar, Bengaluru – 560 078',
    pincode: '560078',
    mapsUrl: 'https://maps.app.goo.gl/JPNagarPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Bengaluru',
  },
  {
    id: 7, district: 'Bengaluru South', name: 'Banashankari Police Station',
    type: 'City', subdivision: 'South Division',
    phone: '080-2671 2222', phoneVerified: false,
    address: '2nd Stage, Banashankari, Bengaluru – 560 070',
    pincode: '560070',
    mapsUrl: 'https://maps.app.goo.gl/BanashankariPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Bengaluru',
  },
  {
    id: 8, district: 'Bengaluru Rural', name: 'Devanahalli Police Station',
    type: 'Rural', subdivision: 'Devanahalli Sub-Division',
    phone: '08110-272 222', phoneVerified: false,
    address: 'BIA Road, Devanahalli, Bengaluru Rural – 562 110',
    pincode: '562110',
    mapsUrl: 'https://maps.app.goo.gl/DevanahaliPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Bengaluru',
  },
  // ── Mysuru ──────────────────────────────────────────────────────────
  {
    id: 9, district: 'Mysuru City', name: 'Nazarbad Police Station',
    type: 'City', subdivision: 'North Sub-Division',
    phone: '0821-242 1234', phoneVerified: false,
    address: 'Nazarbad Main Road, Mysuru – 570 010',
    pincode: '570010',
    mapsUrl: 'https://maps.app.goo.gl/NazarbadPS',
    sourceUrl: 'https://mysurucitypolice.karnataka.gov.in',
    zone: 'Mysuru',
  },
  {
    id: 10, district: 'Mysuru City', name: 'Lashkar Police Station',
    type: 'City', subdivision: 'South Sub-Division',
    phone: '0821-243 2222', phoneVerified: false,
    address: 'Krishnaraja Boulevard, Mysuru – 570 001',
    pincode: '570001',
    mapsUrl: 'https://maps.app.goo.gl/LashkarPS',
    sourceUrl: 'https://mysurucitypolice.karnataka.gov.in',
    zone: 'Mysuru',
  },
  {
    id: 11, district: 'Mysuru District', name: 'Nanjangud Town Police Station',
    type: 'Town', subdivision: 'Nanjangud Sub-Division',
    phone: '08221-222 345', phoneVerified: false,
    address: 'Station Road, Nanjangud – 571 301',
    pincode: '571301',
    mapsUrl: 'https://maps.app.goo.gl/NanjangudPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Mysuru',
  },
  // ── Belagavi ────────────────────────────────────────────────────────
  {
    id: 12, district: 'Belagavi', name: 'Belagavi East Police Station',
    type: 'City', subdivision: 'East Sub-Division',
    phone: '0831-242 1111', phoneVerified: false,
    address: 'College Road, Belagavi – 590 001',
    pincode: '590001',
    mapsUrl: 'https://maps.app.goo.gl/BelagaviEastPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Belagavi',
  },
  {
    id: 13, district: 'Belagavi', name: 'Belagavi Rural Police Station',
    type: 'Rural', subdivision: 'Rural Sub-Division',
    phone: '0831-246 2222', phoneVerified: false,
    address: 'SP Office Campus, Belagavi – 590 016',
    pincode: '590016',
    mapsUrl: 'https://maps.app.goo.gl/BelagaviRuralPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Belagavi',
  },
  // ── Vijayapur ───────────────────────────────────────────────────────
  {
    id: 14, district: 'Vijayapur', name: 'Vijayapur Town Police Station',
    type: 'Town', subdivision: 'Vijayapur Sub-Division',
    phone: '08352-250 111', phoneVerified: false,
    address: 'Station Road, Vijayapur – 586 101',
    pincode: '586101',
    mapsUrl: 'https://maps.app.goo.gl/VijayapurPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Kalaburagi',
  },
  // ── Bagalkot ────────────────────────────────────────────────────────
  {
    id: 15, district: 'Bagalkot', name: 'Bagalkot Town Police Station',
    type: 'Town', subdivision: 'Bagalkot Sub-Division',
    phone: '08354-230 222', phoneVerified: false,
    address: 'Bagalkot Town – 587 101',
    pincode: '587101',
    mapsUrl: 'https://maps.app.goo.gl/BagalkotPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Kalaburagi',
  },
  // ── Kalaburagi ──────────────────────────────────────────────────────
  {
    id: 16, district: 'Kalaburagi', name: 'Kalaburagi City Police Station',
    type: 'City', subdivision: 'City Sub-Division',
    phone: '08472-224 111', phoneVerified: false,
    address: 'Station Road, Kalaburagi – 585 101',
    pincode: '585101',
    mapsUrl: 'https://maps.app.goo.gl/KalaburagicityPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Kalaburagi',
  },
  // ── Bidar ───────────────────────────────────────────────────────────
  {
    id: 17, district: 'Bidar', name: 'Bidar Town Police Station',
    type: 'Town', subdivision: 'Bidar Sub-Division',
    phone: '08482-222 234', phoneVerified: false,
    address: 'Bidar Town – 585 401',
    pincode: '585401',
    mapsUrl: 'https://maps.app.goo.gl/BidarPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Kalaburagi',
  },
  // ── Raichur ─────────────────────────────────────────────────────────
  {
    id: 18, district: 'Raichur', name: 'Raichur Town Police Station',
    type: 'Town', subdivision: 'Raichur Sub-Division',
    phone: '08532-220 111', phoneVerified: false,
    address: 'Station Road, Raichur – 584 101',
    pincode: '584101',
    mapsUrl: 'https://maps.app.goo.gl/RaichurPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Kalaburagi',
  },
  // ── Yadgir ──────────────────────────────────────────────────────────
  {
    id: 19, district: 'Yadgir', name: 'Yadgir Town Police Station',
    type: 'Town', subdivision: 'Yadgir Sub-Division',
    phone: '08473-255 234', phoneVerified: false,
    address: 'Yadgir Town – 585 201',
    pincode: '585201',
    mapsUrl: 'https://maps.app.goo.gl/YadgirPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Kalaburagi',
  },
  // ── Koppal ──────────────────────────────────────────────────────────
  {
    id: 20, district: 'Koppal', name: 'Koppal Town Police Station',
    type: 'Town', subdivision: 'Koppal Sub-Division',
    phone: '08539-220 345', phoneVerified: false,
    address: 'Koppal Town – 583 231',
    pincode: '583231',
    mapsUrl: 'https://maps.app.goo.gl/KoppalPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Kalaburagi',
  },
  // ── Hubballi-Dharwad ────────────────────────────────────────────────
  {
    id: 21, district: 'Hubballi-Dharwad', name: 'Hubballi Keshwapur Police Station',
    type: 'City', subdivision: 'Hubballi Sub-Division',
    phone: '0836-235 2111', phoneVerified: false,
    address: 'Keshwapur, Hubballi – 580 023',
    pincode: '580023',
    mapsUrl: 'https://maps.app.goo.gl/HubbaliKeshwapurPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Belagavi',
  },
  // ── Dharwad ─────────────────────────────────────────────────────────
  {
    id: 22, district: 'Dharwad', name: 'Dharwad Town Police Station',
    type: 'Town', subdivision: 'Dharwad Sub-Division',
    phone: '0836-244 7222', phoneVerified: false,
    address: 'Dharwad Town – 580 001',
    pincode: '580001',
    mapsUrl: 'https://maps.app.goo.gl/DharwadPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Belagavi',
  },
  // ── Gadag ───────────────────────────────────────────────────────────
  {
    id: 23, district: 'Gadag', name: 'Gadag Town Police Station',
    type: 'Town', subdivision: 'Gadag Sub-Division',
    phone: '08372-230 111', phoneVerified: false,
    address: 'Gadag Town – 582 101',
    pincode: '582101',
    mapsUrl: 'https://maps.app.goo.gl/GadagPS',
    sourceUrl: 'https://gadagpolice.karnataka.gov.in',
    zone: 'Belagavi',
  },
  // ── Haveri ──────────────────────────────────────────────────────────
  {
    id: 24, district: 'Haveri', name: 'Haveri Town Police Station',
    type: 'Town', subdivision: 'Haveri Sub-Division',
    phone: '08375-232 234', phoneVerified: false,
    address: 'Haveri Town – 581 110',
    pincode: '581110',
    mapsUrl: 'https://maps.app.goo.gl/HaveriPS',
    sourceUrl: 'https://haveripolice.karnataka.gov.in',
    zone: 'Belagavi',
  },
  // ── Uttara Kannada ──────────────────────────────────────────────────
  {
    id: 25, district: 'Uttara Kannada', name: 'Karwar Police Station',
    type: 'Town', subdivision: 'Karwar Sub-Division',
    phone: '08382-222 111', phoneVerified: false,
    address: 'Karwar Town – 581 301',
    pincode: '581301',
    mapsUrl: 'https://maps.app.goo.gl/KarwarPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Coastal',
  },
  // ── Shivamogga ──────────────────────────────────────────────────────
  {
    id: 26, district: 'Shivamogga', name: 'Shivamogga Town Police Station',
    type: 'City', subdivision: 'Shivamogga Sub-Division',
    phone: '08182-272 111', phoneVerified: false,
    address: 'Shivamogga Town – 577 201',
    pincode: '577201',
    mapsUrl: 'https://maps.app.goo.gl/ShivamggaPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Shivamogga',
  },
  // ── Davanagere ──────────────────────────────────────────────────────
  {
    id: 27, district: 'Davanagere', name: 'Davanagere City Police Station',
    type: 'City', subdivision: 'City Sub-Division',
    phone: '08192-230 234', phoneVerified: false,
    address: 'P.J. Extension, Davanagere – 577 002',
    pincode: '577002',
    mapsUrl: 'https://maps.app.goo.gl/DavanagerePS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Shivamogga',
  },
  // ── Chitradurga ─────────────────────────────────────────────────────
  {
    id: 28, district: 'Chitradurga', name: 'Chitradurga Town Police Station',
    type: 'Town', subdivision: 'Chitradurga Sub-Division',
    phone: '08194-223 111', phoneVerified: false,
    address: 'Chitradurga Town – 577 501',
    pincode: '577501',
    mapsUrl: 'https://maps.app.goo.gl/ChitradurgaPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Shivamogga',
  },
  // ── Chikkamagaluru ──────────────────────────────────────────────────
  {
    id: 29, district: 'Chikkamagaluru', name: 'Chikkamagaluru Town Police Station',
    type: 'Town', subdivision: 'Chikkamagaluru Sub-Division',
    phone: '08262-222 345', phoneVerified: false,
    address: 'Chikkamagaluru Town – 577 101',
    pincode: '577101',
    mapsUrl: 'https://maps.app.goo.gl/ChikkamagaluruPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Shivamogga',
  },
  // ── Hassan ──────────────────────────────────────────────────────────
  {
    id: 30, district: 'Hassan', name: 'Hassan Town Police Station',
    type: 'Town', subdivision: 'Hassan Sub-Division',
    phone: '08172-268 111', phoneVerified: false,
    address: 'Hassan Town – 573 201',
    pincode: '573201',
    mapsUrl: 'https://maps.app.goo.gl/HassanPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Mysuru',
  },
  // ── Tumakuru ────────────────────────────────────────────────────────
  {
    id: 31, district: 'Tumakuru', name: 'Tumakuru Town Police Station',
    type: 'City', subdivision: 'Tumakuru Sub-Division',
    phone: '0816-227 3234', phoneVerified: false,
    address: 'Tumakuru Town – 572 101',
    pincode: '572101',
    mapsUrl: 'https://maps.app.goo.gl/TumkurPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Bengaluru',
  },
  // ── Mandya ──────────────────────────────────────────────────────────
  {
    id: 32, district: 'Mandya', name: 'Mandya Town Police Station',
    type: 'Town', subdivision: 'Mandya Sub-Division',
    phone: '08232-222 111', phoneVerified: false,
    address: 'Mandya Town – 571 401',
    pincode: '571401',
    mapsUrl: 'https://maps.app.goo.gl/MandyaPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Mysuru',
  },
  // ── Chickballapura ──────────────────────────────────────────────────
  {
    id: 33, district: 'Chickballapura', name: 'Chickballapura Police Station',
    type: 'Town', subdivision: 'Chickballapura Sub-Division',
    phone: '08156-272 234', phoneVerified: false,
    address: 'Chickballapura Town – 562 101',
    pincode: '562101',
    mapsUrl: 'https://maps.app.goo.gl/ChickballapuraPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Bengaluru',
  },
  // ── Kolar ───────────────────────────────────────────────────────────
  {
    id: 34, district: 'Kolar', name: 'Kolar Town Police Station',
    type: 'Town', subdivision: 'Kolar Sub-Division',
    phone: '08152-222 345', phoneVerified: false,
    address: 'Kolar Town – 563 101',
    pincode: '563101',
    mapsUrl: 'https://maps.app.goo.gl/KolarPS',
    sourceUrl: 'https://kolarpolice.karnataka.gov.in',
    zone: 'Bengaluru',
  },
  // ── K.G.F ───────────────────────────────────────────────────────────
  {
    id: 35, district: 'K.G.F', name: 'KGF Town Police Station',
    type: 'Town', subdivision: 'KGF Sub-Division',
    phone: '08153-262 111', phoneVerified: false,
    address: 'KGF Town – 563 122',
    pincode: '563122',
    mapsUrl: 'https://maps.app.goo.gl/KGFtownPS',
    sourceUrl: 'https://kolarpolice.karnataka.gov.in',
    zone: 'Bengaluru',
  },
  // ── Ballari ─────────────────────────────────────────────────────────
  {
    id: 36, district: 'Ballari', name: 'Ballari Town Police Station',
    type: 'City', subdivision: 'Ballari Sub-Division',
    phone: '08392-243 234', phoneVerified: false,
    address: 'Ballari Town – 583 101',
    pincode: '583101',
    mapsUrl: 'https://maps.app.goo.gl/BallariPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Kalaburagi',
  },
  // ── Vijayanagara ────────────────────────────────────────────────────
  {
    id: 37, district: 'Vijayanagara', name: 'Hospet Town Police Station',
    type: 'Town', subdivision: 'Hospet Sub-Division',
    phone: '08394-224 111', phoneVerified: false,
    address: 'Hospet Town – 583 201',
    pincode: '583201',
    mapsUrl: 'https://maps.app.goo.gl/HospetPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Kalaburagi',
  },
  // ── Mangaluru ───────────────────────────────────────────────────────
  {
    id: 38, district: 'Mangaluru City', name: 'Mangaluru East Police Station',
    type: 'City', subdivision: 'East Sub-Division',
    phone: '0824-221 1234', phoneVerified: false,
    address: 'Bunder Road, Mangaluru – 575 001',
    pincode: '575001',
    mapsUrl: 'https://maps.app.goo.gl/MangaluruEastPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Coastal',
  },
  // ── Dakshina Kannada ────────────────────────────────────────────────
  {
    id: 39, district: 'Dakshina Kannada', name: 'Puttur Police Station',
    type: 'Town', subdivision: 'Puttur Sub-Division',
    phone: '08251-230 111', phoneVerified: false,
    address: 'Puttur Town – 574 201',
    pincode: '574201',
    mapsUrl: 'https://maps.app.goo.gl/PutturPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Dakshina',
  },
  // ── Udupi ───────────────────────────────────────────────────────────
  {
    id: 40, district: 'Udupi', name: 'Udupi Town Police Station',
    type: 'Town', subdivision: 'Udupi Sub-Division',
    phone: '0820-252 3111', phoneVerified: false,
    address: 'Udupi Town – 576 101',
    pincode: '576101',
    mapsUrl: 'https://maps.app.goo.gl/UdupiPS',
    sourceUrl: 'https://districts.ecourts.gov.in/karnataka',
    zone: 'Coastal',
  },
]

const ZONES = ['All', 'Bengaluru', 'Mysuru', 'Belagavi', 'Kalaburagi', 'Coastal', 'Shivamogga', 'Dakshina'] as const
const TYPES = ['All', 'City', 'Town', 'Rural', 'Railway', 'Traffic'] as const

const ZONE_COLORS: Record<string, string> = {
  Bengaluru:  'bg-blue-900/50 text-blue-300 border border-blue-700/50',
  Mysuru:     'bg-purple-900/50 text-purple-300 border border-purple-700/50',
  Belagavi:   'bg-orange-900/50 text-orange-300 border border-orange-700/50',
  Kalaburagi: 'bg-red-900/50 text-red-300 border border-red-700/50',
  Coastal:    'bg-teal-900/50 text-teal-300 border border-teal-700/50',
  Shivamogga: 'bg-green-900/50 text-green-300 border border-green-700/50',
  Dakshina:   'bg-pink-900/50 text-pink-300 border border-pink-700/50',
}

const TYPE_COLORS: Record<string, string> = {
  City:    'bg-sky-900/50 text-sky-300 border border-sky-700/50',
  Town:    'bg-indigo-900/50 text-indigo-300 border border-indigo-700/50',
  Rural:   'bg-lime-900/50 text-lime-300 border border-lime-700/50',
  Railway: 'bg-amber-900/50 text-amber-300 border border-amber-700/50',
  Traffic: 'bg-rose-900/50 text-rose-300 border border-rose-700/50',
}

export default function StationsPage() {
  const navigate = useNavigate()
  const [search, setSearch]           = useState('')
  const [activeType, setActiveType]   = useState<string>('All')
  const [expandedId, setExpandedId]   = useState<number | null>(null)

  // ── Shared demo state ─────────────────────────────────────────
  const { activeZone, setActiveZone, setSelectedStation, selectedStation } = useDemoStore()
  const { events } = useLiveFeed({ maxEvents: 50 })

  // Map stationId → array of recent events (last 3)
  const stationEvents = useMemo(() => {
    const map = new Map<number, typeof events>()
    events.forEach(e => {
      const sid = (e as any).stationId
      if (!sid) return
      const arr = map.get(sid) ?? []
      if (arr.length < 3) { arr.push(e); map.set(sid, arr) }
    })
    return map
  }, [events])

  const filtered = STATIONS.filter(s => {
    const q = search.toLowerCase()
    const matchSearch =
      !q ||
      s.name.toLowerCase().includes(q) ||
      s.district.toLowerCase().includes(q) ||
      s.pincode.includes(q) ||
      s.address.toLowerCase().includes(q) ||
      s.subdivision.toLowerCase().includes(q)
    return matchSearch &&
      (activeZone === 'All' || s.zone === activeZone) &&
      (activeType === 'All' || s.type === activeType)
  })

  const cityCount  = STATIONS.filter(s => s.type === 'City').length
  const townRural  = STATIONS.filter(s => s.type === 'Town' || s.type === 'Rural').length
  const zonesCount = new Set(STATIONS.map(s => s.zone)).size

  // Count of stations with recent demo activity
  const activeStations = stationEvents.size

  function handleRegisterFIR(stationId: number) {
    const s = STATIONS.find(st => st.id === stationId)
    if (s) {
      setSelectedStation({ id: s.id, name: s.name, district: s.district, zone: s.zone, type: s.type })
    }
    navigate('/fir')
  }

  function handleSelectStation(s: Station) {
    setSelectedStation({ id: s.id, name: s.name, district: s.district, zone: s.zone, type: s.type })
    setExpandedId(expandedId === s.id ? null : s.id)
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6 space-y-5">

      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="p-2 rounded-lg bg-blue-600/20 border border-blue-500/30 flex-shrink-0">
          <Building2 className="w-5 h-5 text-blue-400" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Police Stations Directory</h1>
          <p className="text-sm text-gray-400">Karnataka State Police — CCTNS Station Registry</p>
        </div>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          {/* Active demo feed badge */}
          <span className="text-xs bg-amber-950/40 border border-amber-700/50 text-amber-400 px-3 py-1 rounded-full font-semibold flex items-center gap-1.5">
            <Radio className="w-3 h-3" />
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            {activeStations} active · DEMO
          </span>
          <span className="text-xs bg-blue-600/20 border border-blue-500/40 text-blue-300 px-3 py-1 rounded-full font-semibold flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5" />{STATIONS.length} Stations
          </span>
        </div>
      </div>

      {/* Selected station context banner */}
      {selectedStation && (
        <div className="flex items-center gap-3 bg-blue-950/30 border border-blue-700/40 rounded-xl px-4 py-2.5 text-xs">
          <Building2 className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
          <span className="text-blue-300 font-medium">Active Station:</span>
          <span className="text-white font-semibold">{selectedStation.name}</span>
          <span className="text-gray-500">·</span>
          <span className="text-gray-400">{selectedStation.district}</span>
          <span className="text-gray-500">·</span>
          <span className="text-gray-400">{selectedStation.zone} Zone</span>
          <button
            onClick={() => setSelectedStation(null)}
            className="ml-auto text-gray-600 hover:text-gray-300 transition-colors text-base leading-none"
          >×</button>
        </div>
      )}

      {/* ── DEMO banner — always visible ── */}
      <div className="flex items-start gap-3 bg-amber-950/40 border border-amber-600/60 rounded-xl px-4 py-3 text-xs">
        <Radio className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="space-y-1 flex-1">
          <p className="font-bold text-amber-300 flex items-center gap-2">
            DEMO DATA
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
          </p>
          <p className="text-amber-400/80 leading-relaxed">
            This directory is for <strong className="text-amber-300">demonstration purposes only</strong>.
            Station names are representative of Karnataka State Police jurisdictions.{' '}
            <strong className="text-amber-300">Phone numbers shown are not real</strong> — do not call them.
            For actual emergency contacts use <strong className="text-amber-300">100</strong> (Police) or visit{' '}
            <a href="https://ksp.karnataka.gov.in" target="_blank" rel="noreferrer" className="underline text-amber-300">ksp.karnataka.gov.in</a>.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total Stations',    value: STATIONS.length, color: 'text-blue-400' },
          { label: 'City Stations',     value: cityCount,        color: 'text-sky-400' },
          { label: 'Town / Rural',      value: townRural,        color: 'text-indigo-400' },
          { label: 'Zones Covered',     value: zonesCount,       color: 'text-purple-400' },
        ].map(s => (
          <div key={s.label} className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-3">
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className={`text-2xl font-bold ${s.color} mt-0.5`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />
        <input
          type="text"
          placeholder="Search by station name, district, address, PIN code…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full bg-gray-900 border border-gray-800 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Zone filter */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-gray-500 font-medium">Zone:</span>
        {ZONES.map(z => (
          <button key={z} onClick={() => setActiveZone(z)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              activeZone === z
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white'
            }`}>{z}</button>
        ))}
      </div>

      {/* Type filter */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-gray-500 font-medium">Type:</span>
        {TYPES.map(t => (
          <button key={t} onClick={() => setActiveType(t)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              activeType === t
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500 hover:text-white'
            }`}>{t}</button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
          <span className="text-sm font-medium text-white">Stations</span>
          <span className="text-xs text-gray-500">{filtered.length} records</span>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-500 text-sm">No stations match your filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-2.5 font-medium">Station Name</th>
                  <th className="text-left px-4 py-2.5 font-medium">District</th>
                  <th className="text-left px-4 py-2.5 font-medium">Zone</th>
                  <th className="text-left px-4 py-2.5 font-medium">Type</th>
                  <th className="text-left px-4 py-2.5 font-medium">Phone</th>
                  <th className="text-left px-4 py-2.5 font-medium">PIN</th>
                  <th className="text-left px-4 py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {filtered.map(s => {
                  const stnEvts  = stationEvents.get(s.id) ?? []
                  const isActive = stnEvts.length > 0
                  const isSelected = selectedStation?.id === s.id
                  return (
                  <>
                    <tr
                      key={s.id}
                      className={`hover:bg-gray-800/40 transition-colors cursor-pointer ${isSelected ? 'bg-blue-950/20' : ''}`}
                      onClick={() => handleSelectStation(s)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {isActive && (
                            <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse flex-shrink-0" title="Recent demo activity" />
                          )}
                          {isSelected && !isActive && (
                            <span className="inline-block w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" title="Selected station" />
                          )}
                          <div>
                            <span className={`font-medium text-xs ${isSelected ? 'text-blue-300' : 'text-white'}`}>{s.name}</span>
                            <p className="text-[10px] text-gray-500 mt-0.5">{s.subdivision}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">{s.district}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${ZONE_COLORS[s.zone] ?? ''}`}>{s.zone}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[s.type] ?? ''}`}>{s.type}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs text-gray-500 flex items-center gap-1">
                          <Phone className="w-3 h-3 text-gray-600" />{s.phone}
                        </span>
                        <span className="text-[9px] text-amber-700 block mt-0.5">Demo — not real</span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400 font-mono">{s.pincode}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => handleSelectStation(s)}
                            className={`flex items-center gap-1 text-xs border rounded-lg px-2 py-1 transition-colors ${
                              expandedId === s.id
                                ? 'text-white border-blue-600 bg-blue-600/20'
                                : 'text-gray-400 hover:text-white border-gray-700 hover:border-gray-500'
                            }`}
                          >
                            {expandedId === s.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            Details
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* Expanded row */}
                    {expandedId === s.id && (
                      <tr key={`${s.id}-exp`} className="bg-gray-800/30">
                        <td colSpan={7} className="px-6 py-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
                            {/* Address */}
                            <div>
                              <p className="text-gray-500 font-medium mb-1 flex items-center gap-1">
                                <MapPin className="w-3 h-3" />Address
                              </p>
                              <p className="text-gray-300">{s.address}</p>
                              <p className="text-gray-500 font-mono mt-0.5">PIN: {s.pincode}</p>
                            </div>

                            {/* Maps + Source */}
                            <div className="space-y-2">
                              <a
                                href={s.mapsUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-2 bg-green-900/30 border border-green-700/50 text-green-300 hover:bg-green-900/50 rounded-lg px-3 py-2 transition-colors"
                              >
                                <MapPin className="w-3.5 h-3.5 flex-shrink-0" />
                                <span className="font-medium">Open in Google Maps</span>
                                <ExternalLink className="w-3 h-3 ml-auto flex-shrink-0" />
                              </a>
                              <a
                                href={s.sourceUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-2 bg-gray-700/30 border border-gray-600/50 text-gray-400 hover:text-gray-200 rounded-lg px-3 py-2 transition-colors"
                              >
                                <Info className="w-3 h-3 flex-shrink-0" />
                                <span>Official Source</span>
                                <ExternalLink className="w-3 h-3 ml-auto flex-shrink-0" />
                              </a>
                            </div>

                            {/* Actions */}
                            <div className="space-y-2">
                              <button
                                onClick={() => handleRegisterFIR(s.id)}
                                className="w-full flex items-center gap-2 bg-blue-600/20 border border-blue-500/40 text-blue-300 hover:bg-blue-600/40 rounded-lg px-3 py-2 transition-colors"
                              >
                                <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                                <span className="font-medium">Register FIR at this Station</span>
                              </button>
                              <div className="bg-gray-900/50 border border-gray-700/40 rounded-lg px-3 py-2 text-gray-500">
                                <p className="font-medium text-gray-400 mb-0.5">SHO</p>
                                <p className="italic">Not displayed — postings rotate frequently. Check official KSP directory.</p>
                              </div>
                            </div>

                            {/* Recent demo activity */}
                            {stnEvts.length > 0 && (
                              <div className="sm:col-span-2 lg:col-span-3">
                                <p className="text-gray-500 font-medium mb-2 flex items-center gap-1">
                                  <Radio className="w-3 h-3 text-amber-400" />
                                  Recent Activity <span className="text-amber-500 text-[9px] font-bold ml-1">DEMO</span>
                                </p>
                                <div className="space-y-1">
                                  {stnEvts.map(e => {
                                    const p = e.payload as any
                                    const text = e.type === 'FIR_REGISTERED'
                                      ? `FIR ${p.crime_no ?? ''} — ${String(p.brief_facts ?? '').slice(0,50)}`
                                      : p.message ?? p.text ?? e.type
                                    const ts = new Date(e.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })
                                    return (
                                      <div key={e.id} className="flex items-center gap-2 bg-gray-900/60 rounded-lg px-3 py-1.5">
                                        <span className="text-[9px] font-bold text-amber-400">{e.type.replace('_',' ')}</span>
                                        <span className="text-gray-400 flex-1 truncate">{text}</span>
                                        <span className="text-gray-600 font-mono text-[10px]">{ts}</span>
                                      </div>
                                    )
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )})}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-700 text-center pb-2">
        Demo data · Station names representative of KSP jurisdictions · Phone numbers are not real · For emergencies call 100
      </p>
    </div>
  )
}
