import { useState, useEffect, useRef } from 'react'
import { TrendingUp, X, MapPin } from 'lucide-react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const KA_CENTER = { lat: 15.3173, lng: 75.7139 }

// ── District data keyed by month (Jan–Jun 2026, from PDF page 18) ──
type DistrictStats = { id: number; name: string; lat: number; lng: number; murder: number; dacoity: number; robbery: number; theft: number; cyber: number; ndps: number; pocso: number; scst: number; hurt: number; riots: number }

// Base coordinates — verified district headquarters, all within Karnataka state boundaries
const DIST_COORDS: Record<string, { lat: number; lng: number }> = {
  // ── Bengaluru zone ──────────────────────────────────────────
  'Bengaluru City':    { lat: 12.9716, lng: 77.5946 },  // Bengaluru city centre
  'Bengaluru South':   { lat: 12.8230, lng: 77.6730 },  // Bommanahalli / south zone
  'Bengaluru District':{ lat: 13.0827, lng: 77.5877 },  // Bengaluru Rural HQ (Devanahalli area)
  // ── Mysuru zone ─────────────────────────────────────────────
  'Mysuru City':       { lat: 12.2958, lng: 76.6394 },  // Mysuru city
  'Mysuru District':   { lat: 12.1084, lng: 76.5325 },  // Mysuru rural (Nanjangud area)
  // ── Belagavi zone ───────────────────────────────────────────
  'Belagavi District': { lat: 15.8497, lng: 74.4977 },  // Belagavi district HQ
  'Belagavi City':     { lat: 15.8697, lng: 74.5177 },  // Belagavi city police
  // ── North Karnataka ─────────────────────────────────────────
  'Hubballi-Dharwad':  { lat: 15.3647, lng: 75.1240 },  // Hubballi
  'Dharwad':           { lat: 15.4589, lng: 75.0078 },  // Dharwad town
  'Gadag':             { lat: 15.4166, lng: 75.6267 },  // Gadag
  'Haveri':            { lat: 14.7957, lng: 75.4013 },  // Haveri
  'Bagalkot':          { lat: 16.1826, lng: 75.6969 },  // Bagalkot
  'Vijayapur':         { lat: 16.8302, lng: 75.7100 },  // Vijayapur (Bijapur)
  'Uttara Kannada':    { lat: 14.7860, lng: 74.6920 },  // Karwar (Uttara Kannada HQ)
  // ── Hyderabad-Karnataka — shifted slightly west so markers visually clear Telangana label area
  'Kalaburagi Dist':   { lat: 17.3297, lng: 76.6500 },  // Kalaburagi district SP office
  'Kalaburagi City':   { lat: 17.1800, lng: 76.5800 },  // Kalaburagi city commissionerate
  'Kalaburagi':        { lat: 16.9200, lng: 76.4800 },  // Kalaburagi rural / south subdivision
  'Bidar':             { lat: 17.9104, lng: 77.3200 },  // Bidar SP office — pulled west of border
  'Raichur':           { lat: 16.2120, lng: 77.0500 },  // Raichur SP office — pulled west
  'Koppal':            { lat: 15.3511, lng: 76.1549 },  // Koppal — correct
  'Yadgir':            { lat: 16.7000, lng: 76.8500 },  // Yadgir SP — pulled west of Telangana border
  'Vijayanagara':      { lat: 15.1394, lng: 76.4600 },  // Hospet / Vijayanagara HQ
  // ── Central Karnataka ────────────────────────────────────────
  'Davanagere':        { lat: 14.4644, lng: 75.9214 },  // Davanagere
  'Shivamogga':        { lat: 13.9299, lng: 75.5681 },  // Shivamogga
  'Chitradurga':       { lat: 14.2251, lng: 76.3980 },  // Chitradurga
  'Ballari':           { lat: 15.1394, lng: 76.9214 },  // Ballari
  'Chikkamagaluru':    { lat: 13.3161, lng: 75.7720 },  // Chikkamagaluru
  'Hassan':            { lat: 13.0033, lng: 76.1004 },  // Hassan
  'Kodagu':            { lat: 12.4210, lng: 75.7382 },  // Madikeri (Kodagu HQ)
  // ── South Karnataka ─────────────────────────────────────────
  'Tumakuru':          { lat: 13.3379, lng: 77.1173 },  // Tumakuru
  'Mandya':            { lat: 12.5218, lng: 76.8951 },  // Mandya
  'Chickballapura':    { lat: 13.4356, lng: 77.7279 },  // Chickballapura
  'Kolar':             { lat: 13.1367, lng: 78.1294 },  // Kolar
  'K.G.F':             { lat: 12.9577, lng: 78.2673 },  // Kolar Gold Fields
  // ── Coastal Karnataka ────────────────────────────────────────
  'Mangaluru City':    { lat: 12.9141, lng: 74.8560 },  // Mangaluru
  'Dakshina Kannada':  { lat: 12.7673, lng: 75.2479 },  // Puttur (DK rural HQ)
  'Udupi':             { lat: 13.3409, lng: 74.7421 },  // Udupi
  // ── Special units ────────────────────────────────────────────
  'Karnataka Railways':{ lat: 15.0000, lng: 76.5000 },  // Central point — railway police HQ
}

// District stats per month (sourced from PDF page 18)
const DISTRICT_BY_MONTH: Record<string, DistrictStats[]> = {
  jan: [
    { id:1,  name:'Bengaluru City',    ...DIST_COORDS['Bengaluru City'],    murder:13, dacoity:1, robbery:7,  theft:498, cyber:213, ndps:31,  pocso:85, scst:46, hurt:446, riots:48 },
    { id:2,  name:'Mysuru City',       ...DIST_COORDS['Mysuru City'],       murder:5,  dacoity:0, robbery:4,  theft:161, cyber:48,  ndps:15,  pocso:45, scst:14, hurt:232, riots:22 },
    { id:3,  name:'Belagavi District', ...DIST_COORDS['Belagavi District'], murder:8,  dacoity:1, robbery:2,  theft:63,  cyber:14,  ndps:23,  pocso:32, scst:14, hurt:116, riots:46 },
    { id:4,  name:'Kalaburagi Dist',   ...DIST_COORDS['Kalaburagi Dist'],   murder:3,  dacoity:0, robbery:1,  theft:25,  cyber:4,   ndps:20,  pocso:8,  scst:22, hurt:68,  riots:13 },
    { id:5,  name:'Davanagere',        ...DIST_COORDS['Davanagere'],        murder:2,  dacoity:0, robbery:0,  theft:107, cyber:21,  ndps:20,  pocso:26, scst:7,  hurt:152, riots:34 },
    { id:6,  name:'Shivamogga',        ...DIST_COORDS['Shivamogga'],        murder:4,  dacoity:1, robbery:1,  theft:113, cyber:29,  ndps:37,  pocso:35, scst:5,  hurt:173, riots:18 },
    { id:7,  name:'Tumakuru',          ...DIST_COORDS['Tumakuru'],          murder:3,  dacoity:0, robbery:1,  theft:112, cyber:17,  ndps:22,  pocso:34, scst:14, hurt:231, riots:58 },
    { id:8,  name:'Mangaluru City',    ...DIST_COORDS['Mangaluru City'],    murder:0,  dacoity:0, robbery:1,  theft:65,  cyber:19,  ndps:17,  pocso:24, scst:2,  hurt:108, riots:15 },
    { id:9,  name:'Hubballi-Dharwad',  ...DIST_COORDS['Hubballi-Dharwad'],  murder:2,  dacoity:0, robbery:2,  theft:87,  cyber:24,  ndps:44,  pocso:13, scst:9,  hurt:147, riots:38 },
    { id:10, name:'Bagalkot',          ...DIST_COORDS['Bagalkot'],          murder:3,  dacoity:1, robbery:1,  theft:42,  cyber:2,   ndps:31,  pocso:8,  scst:4,  hurt:121, riots:48 },
    { id:11, name:'Raichur',           ...DIST_COORDS['Raichur'],           murder:2,  dacoity:0, robbery:0,  theft:31,  cyber:0,   ndps:23,  pocso:8,  scst:26, hurt:85,  riots:30 },
    { id:12, name:'Ballari',           ...DIST_COORDS['Ballari'],           murder:6,  dacoity:0, robbery:3,  theft:79,  cyber:13,  ndps:32,  pocso:31, scst:32, hurt:119, riots:44 },
    { id:13, name:'Dharwad',           ...DIST_COORDS['Dharwad'],           murder:1,  dacoity:0, robbery:0,  theft:48,  cyber:6,   ndps:18,  pocso:7,  scst:2,  hurt:88,  riots:13 },
    { id:14, name:'Haveri',            ...DIST_COORDS['Haveri'],            murder:1,  dacoity:1, robbery:0,  theft:33,  cyber:4,   ndps:32,  pocso:9,  scst:3,  hurt:38,  riots:11 },
    { id:15, name:'Hassan',            ...DIST_COORDS['Hassan'],            murder:2,  dacoity:0, robbery:0,  theft:57,  cyber:10,  ndps:22,  pocso:15, scst:10, hurt:114, riots:31 },
    { id:16, name:'Bidar',             ...DIST_COORDS['Bidar'],             murder:3,  dacoity:0, robbery:1,  theft:39,  cyber:3,   ndps:22,  pocso:16, scst:22, hurt:72,  riots:14 },
    { id:17, name:'Vijayapur',         ...DIST_COORDS['Vijayapur'],         murder:4,  dacoity:0, robbery:2,  theft:44,  cyber:7,   ndps:45,  pocso:9,  scst:15, hurt:86,  riots:22 },
    { id:18, name:'Chitradurga',       ...DIST_COORDS['Chitradurga'],       murder:1,  dacoity:0, robbery:0,  theft:50,  cyber:5,   ndps:14,  pocso:16, scst:11, hurt:110, riots:29 },
    { id:19, name:'Chikkamagaluru',    ...DIST_COORDS['Chikkamagaluru'],    murder:1,  dacoity:0, robbery:0,  theft:45,  cyber:5,   ndps:19,  pocso:8,  scst:1,  hurt:82,  riots:17 },
    { id:20, name:'Chickballapura',    ...DIST_COORDS['Chickballapura'],    murder:1,  dacoity:0, robbery:0,  theft:35,  cyber:5,   ndps:10,  pocso:12, scst:11, hurt:102, riots:22 },
    { id:21, name:'Dakshina Kannada',  ...DIST_COORDS['Dakshina Kannada'],  murder:2,  dacoity:0, robbery:1,  theft:64,  cyber:13,  ndps:19,  pocso:21, scst:5,  hurt:134, riots:20 },
    { id:22, name:'Gadag',             ...DIST_COORDS['Gadag'],             murder:0,  dacoity:0, robbery:0,  theft:28,  cyber:4,   ndps:15,  pocso:6,  scst:3,  hurt:48,  riots:12 },
    { id:23, name:'Kolar',             ...DIST_COORDS['Kolar'],             murder:2,  dacoity:0, robbery:0,  theft:40,  cyber:4,   ndps:8,   pocso:12, scst:11, hurt:82,  riots:18 },
    { id:24, name:'Koppal',            ...DIST_COORDS['Koppal'],            murder:1,  dacoity:0, robbery:0,  theft:24,  cyber:2,   ndps:14,  pocso:6,  scst:11, hurt:52,  riots:16 },
    { id:25, name:'Mandya',            ...DIST_COORDS['Mandya'],            murder:3,  dacoity:0, robbery:1,  theft:53,  cyber:5,   ndps:13,  pocso:14, scst:6,  hurt:124, riots:24 },
    { id:26, name:'Mysuru District',   ...DIST_COORDS['Mysuru District'],   murder:5,  dacoity:1, robbery:2,  theft:70,  cyber:8,   ndps:20,  pocso:22, scst:9,  hurt:130, riots:28 },
    { id:27, name:'Udupi',             ...DIST_COORDS['Udupi'],             murder:0,  dacoity:0, robbery:0,  theft:32,  cyber:10,  ndps:8,   pocso:7,  scst:1,  hurt:62,  riots:7  },
    { id:28, name:'Uttara Kannada',    ...DIST_COORDS['Uttara Kannada'],    murder:0,  dacoity:0, robbery:0,  theft:30,  cyber:5,   ndps:11,  pocso:9,  scst:2,  hurt:55,  riots:10 },
    { id:29, name:'Yadgir',            ...DIST_COORDS['Yadgir'],            murder:2,  dacoity:0, robbery:1,  theft:21,  cyber:3,   ndps:17,  pocso:7,  scst:11, hurt:41,  riots:8  },
    { id:30, name:'Kodagu',            ...DIST_COORDS['Kodagu'],            murder:0,  dacoity:0, robbery:0,  theft:24,  cyber:5,   ndps:7,   pocso:4,  scst:1,  hurt:44,  riots:8  },
    { id:31, name:'K.G.F',             ...DIST_COORDS['K.G.F'],             murder:1,  dacoity:1, robbery:0,  theft:28,  cyber:2,   ndps:9,   pocso:6,  scst:5,  hurt:52,  riots:11 },
    { id:32, name:'Vijayanagara',      ...DIST_COORDS['Vijayanagara'],      murder:3,  dacoity:0, robbery:2,  theft:40,  cyber:5,   ndps:12,  pocso:9,  scst:11, hurt:80,  riots:19 },
    { id:33, name:'Bengaluru South',   ...DIST_COORDS['Bengaluru South'],   murder:4,  dacoity:0, robbery:1,  theft:130, cyber:52,  ndps:11,  pocso:32, scst:7,  hurt:198, riots:34 },
    { id:34, name:'Bengaluru District',...DIST_COORDS['Bengaluru District'], murder:6,  dacoity:0, robbery:0,  theft:104, cyber:15,  ndps:9,   pocso:30, scst:11, hurt:172, riots:24 },
    { id:35, name:'Belagavi City',     ...DIST_COORDS['Belagavi City'],     murder:1,  dacoity:0, robbery:2,  theft:38,  cyber:6,   ndps:17,  pocso:7,  scst:2,  hurt:78,  riots:32 },
    { id:36, name:'Kalaburagi City',   ...DIST_COORDS['Kalaburagi City'],   murder:1,  dacoity:1, robbery:0,  theft:17,  cyber:4,   ndps:3,   pocso:5,  scst:12, hurt:42,  riots:9  },
    { id:37, name:'Karnataka Railways',...DIST_COORDS['Karnataka Railways'], murder:0,  dacoity:0, robbery:0,  theft:22,  cyber:0,   ndps:5,   pocso:2,  scst:0,  hurt:15,  riots:2  },
    { id:38, name:'Kalaburagi',        ...DIST_COORDS['Kalaburagi'],        murder:3,  dacoity:1, robbery:1,  theft:29,  cyber:8,   ndps:4,   pocso:11, scst:33, hurt:78,  riots:21 },
  ],
  feb: [
    { id:1,  name:'Bengaluru City',    ...DIST_COORDS['Bengaluru City'],    murder:15, dacoity:1, robbery:19, theft:686, cyber:182, ndps:44,  pocso:74, scst:14, hurt:350, riots:37 },
    { id:2,  name:'Mysuru City',       ...DIST_COORDS['Mysuru City'],       murder:1,  dacoity:0, robbery:1,  theft:378, cyber:82,  ndps:19,  pocso:32, scst:12, hurt:208, riots:23 },
    { id:3,  name:'Belagavi District', ...DIST_COORDS['Belagavi District'], murder:4,  dacoity:2, robbery:5,  theft:135, cyber:14,  ndps:14,  pocso:39, scst:19, hurt:284, riots:163},
    { id:4,  name:'Kalaburagi Dist',   ...DIST_COORDS['Kalaburagi Dist'],   murder:0,  dacoity:1, robbery:0,  theft:70,  cyber:16,  ndps:23,  pocso:9,  scst:15, hurt:165, riots:32 },
    { id:5,  name:'Davanagere',        ...DIST_COORDS['Davanagere'],        murder:1,  dacoity:0, robbery:2,  theft:126, cyber:20,  ndps:25,  pocso:42, scst:11, hurt:214, riots:37 },
    { id:6,  name:'Shivamogga',        ...DIST_COORDS['Shivamogga'],        murder:2,  dacoity:2, robbery:0,  theft:131, cyber:39,  ndps:56,  pocso:39, scst:6,  hurt:116, riots:17 },
    { id:7,  name:'Tumakuru',          ...DIST_COORDS['Tumakuru'],          murder:5,  dacoity:0, robbery:1,  theft:182, cyber:26,  ndps:30,  pocso:45, scst:22, hurt:356, riots:49 },
    { id:8,  name:'Mangaluru City',    ...DIST_COORDS['Mangaluru City'],    murder:1,  dacoity:1, robbery:1,  theft:73,  cyber:21,  ndps:21,  pocso:27, scst:2,  hurt:110, riots:19 },
    { id:9,  name:'Hubballi-Dharwad',  ...DIST_COORDS['Hubballi-Dharwad'],  murder:1,  dacoity:0, robbery:3,  theft:90,  cyber:26,  ndps:54,  pocso:14, scst:9,  hurt:156, riots:35 },
    { id:10, name:'Bagalkot',          ...DIST_COORDS['Bagalkot'],          murder:4,  dacoity:0, robbery:1,  theft:45,  cyber:2,   ndps:23,  pocso:9,  scst:14, hurt:89,  riots:63 },
    { id:11, name:'Raichur',           ...DIST_COORDS['Raichur'],           murder:1,  dacoity:1, robbery:1,  theft:31,  cyber:1,   ndps:21,  pocso:12, scst:21, hurt:80,  riots:26 },
    { id:12, name:'Ballari',           ...DIST_COORDS['Ballari'],           murder:4,  dacoity:0, robbery:1,  theft:87,  cyber:21,  ndps:19,  pocso:21, scst:43, hurt:127, riots:21 },
    { id:13, name:'Dharwad',           ...DIST_COORDS['Dharwad'],           murder:0,  dacoity:0, robbery:0,  theft:56,  cyber:7,   ndps:20,  pocso:9,  scst:2,  hurt:108, riots:19 },
    { id:14, name:'Haveri',            ...DIST_COORDS['Haveri'],            murder:1,  dacoity:1, robbery:0,  theft:45,  cyber:5,   ndps:30,  pocso:11, scst:3,  hurt:44,  riots:12 },
    { id:15, name:'Hassan',            ...DIST_COORDS['Hassan'],            murder:1,  dacoity:0, robbery:0,  theft:59,  cyber:11,  ndps:20,  pocso:18, scst:8,  hurt:118, riots:30 },
    { id:16, name:'Bidar',             ...DIST_COORDS['Bidar'],             murder:2,  dacoity:0, robbery:1,  theft:38,  cyber:4,   ndps:22,  pocso:17, scst:24, hurt:80,  riots:16 },
    { id:17, name:'Vijayapur',         ...DIST_COORDS['Vijayapur'],         murder:3,  dacoity:0, robbery:1,  theft:55,  cyber:11,  ndps:35,  pocso:12, scst:16, hurt:90,  riots:21 },
    { id:18, name:'Chitradurga',       ...DIST_COORDS['Chitradurga'],       murder:1,  dacoity:0, robbery:0,  theft:53,  cyber:8,   ndps:12,  pocso:10, scst:14, hurt:110, riots:26 },
    { id:19, name:'Chikkamagaluru',    ...DIST_COORDS['Chikkamagaluru'],    murder:2,  dacoity:0, robbery:0,  theft:50,  cyber:7,   ndps:24,  pocso:9,  scst:2,  hurt:95,  riots:13 },
    { id:20, name:'Chickballapura',    ...DIST_COORDS['Chickballapura'],    murder:1,  dacoity:0, robbery:0,  theft:38,  cyber:6,   ndps:11,  pocso:14, scst:10, hurt:110, riots:20 },
    { id:21, name:'Dakshina Kannada',  ...DIST_COORDS['Dakshina Kannada'],  murder:1,  dacoity:0, robbery:0,  theft:68,  cyber:15,  ndps:18,  pocso:22, scst:4,  hurt:140, riots:18 },
    { id:22, name:'Gadag',             ...DIST_COORDS['Gadag'],             murder:0,  dacoity:0, robbery:1,  theft:31,  cyber:5,   ndps:16,  pocso:7,  scst:4,  hurt:50,  riots:14 },
    { id:23, name:'Kolar',             ...DIST_COORDS['Kolar'],             murder:1,  dacoity:1, robbery:2,  theft:45,  cyber:5,   ndps:10,  pocso:13, scst:13, hurt:90,  riots:20 },
    { id:24, name:'Koppal',            ...DIST_COORDS['Koppal'],            murder:0,  dacoity:1, robbery:1,  theft:27,  cyber:3,   ndps:14,  pocso:8,  scst:10, hurt:60,  riots:14 },
    { id:25, name:'Mandya',            ...DIST_COORDS['Mandya'],            murder:2,  dacoity:0, robbery:1,  theft:56,  cyber:5,   ndps:15,  pocso:16, scst:7,  hurt:130, riots:22 },
    { id:26, name:'Mysuru District',   ...DIST_COORDS['Mysuru District'],   murder:1,  dacoity:1, robbery:1,  theft:76,  cyber:10,  ndps:22,  pocso:24, scst:8,  hurt:140, riots:25 },
    { id:27, name:'Udupi',             ...DIST_COORDS['Udupi'],             murder:0,  dacoity:0, robbery:0,  theft:35,  cyber:11,  ndps:9,   pocso:8,  scst:1,  hurt:65,  riots:8  },
    { id:28, name:'Uttara Kannada',    ...DIST_COORDS['Uttara Kannada'],    murder:0,  dacoity:2, robbery:2,  theft:33,  cyber:6,   ndps:12,  pocso:10, scst:2,  hurt:58,  riots:11 },
    { id:29, name:'Yadgir',            ...DIST_COORDS['Yadgir'],            murder:1,  dacoity:0, robbery:0,  theft:23,  cyber:3,   ndps:16,  pocso:8,  scst:10, hurt:45,  riots:9  },
    { id:30, name:'Kodagu',            ...DIST_COORDS['Kodagu'],            murder:0,  dacoity:0, robbery:0,  theft:26,  cyber:6,   ndps:8,   pocso:5,  scst:1,  hurt:46,  riots:8  },
    { id:31, name:'K.G.F',             ...DIST_COORDS['K.G.F'],             murder:0,  dacoity:1, robbery:0,  theft:30,  cyber:3,   ndps:10,  pocso:7,  scst:6,  hurt:55,  riots:12 },
    { id:32, name:'Vijayanagara',      ...DIST_COORDS['Vijayanagara'],      murder:2,  dacoity:0, robbery:1,  theft:44,  cyber:6,   ndps:13,  pocso:10, scst:12, hurt:85,  riots:20 },
    { id:33, name:'Bengaluru South',   ...DIST_COORDS['Bengaluru South'],   murder:2,  dacoity:0, robbery:2,  theft:186, cyber:72,  ndps:14,  pocso:35, scst:8,  hurt:302, riots:32 },
    { id:34, name:'Bengaluru District',...DIST_COORDS['Bengaluru District'], murder:1,  dacoity:0, robbery:0,  theft:163, cyber:21,  ndps:16,  pocso:41, scst:12, hurt:241, riots:23 },
    { id:35, name:'Belagavi City',     ...DIST_COORDS['Belagavi City'],     murder:2,  dacoity:2, robbery:5,  theft:45,  cyber:7,   ndps:18,  pocso:9,  scst:2,  hurt:82,  riots:37 },
    { id:36, name:'Kalaburagi City',   ...DIST_COORDS['Kalaburagi City'],   murder:1,  dacoity:1, robbery:1,  theft:20,  cyber:5,   ndps:4,   pocso:6,  scst:14, hurt:48,  riots:10 },
    { id:37, name:'Karnataka Railways',...DIST_COORDS['Karnataka Railways'], murder:0,  dacoity:0, robbery:0,  theft:22,  cyber:0,   ndps:6,   pocso:2,  scst:0,  hurt:15,  riots:2  },
    { id:38, name:'Kalaburagi',        ...DIST_COORDS['Kalaburagi'],        murder:2,  dacoity:0, robbery:0,  theft:30,  cyber:4,   ndps:18,  pocso:7,  scst:22, hurt:70,  riots:12 },
  ],
  mar: [
    { id:1,  name:'Bengaluru City',    ...DIST_COORDS['Bengaluru City'],    murder:17, dacoity:7, robbery:32, theft:710, cyber:149, ndps:49,  pocso:63, scst:11, hurt:393, riots:126},
    { id:2,  name:'Mysuru City',       ...DIST_COORDS['Mysuru City'],       murder:2,  dacoity:0, robbery:1,  theft:210, cyber:44,  ndps:16,  pocso:34, scst:6,  hurt:235, riots:26 },
    { id:3,  name:'Belagavi District', ...DIST_COORDS['Belagavi District'], murder:6,  dacoity:3, robbery:2,  theft:107, cyber:17,  ndps:19,  pocso:38, scst:15, hurt:275, riots:171},
    { id:4,  name:'Kalaburagi Dist',   ...DIST_COORDS['Kalaburagi Dist'],   murder:3,  dacoity:0, robbery:0,  theft:80,  cyber:14,  ndps:28,  pocso:10, scst:19, hurt:175, riots:38 },
    { id:5,  name:'Davanagere',        ...DIST_COORDS['Davanagere'],        murder:0,  dacoity:0, robbery:3,  theft:145, cyber:22,  ndps:28,  pocso:49, scst:13, hurt:275, riots:46 },
    { id:6,  name:'Shivamogga',        ...DIST_COORDS['Shivamogga'],        murder:1,  dacoity:0, robbery:0,  theft:160, cyber:42,  ndps:88,  pocso:45, scst:7,  hurt:122, riots:18 },
    { id:7,  name:'Tumakuru',          ...DIST_COORDS['Tumakuru'],          murder:4,  dacoity:1, robbery:1,  theft:190, cyber:28,  ndps:38,  pocso:51, scst:25, hurt:390, riots:55 },
    { id:8,  name:'Mangaluru City',    ...DIST_COORDS['Mangaluru City'],    murder:1,  dacoity:0, robbery:1,  theft:78,  cyber:22,  ndps:22,  pocso:28, scst:2,  hurt:118, riots:17 },
    { id:9,  name:'Hubballi-Dharwad',  ...DIST_COORDS['Hubballi-Dharwad'],  murder:2,  dacoity:0, robbery:3,  theft:104, cyber:30,  ndps:68,  pocso:17, scst:10, hurt:165, riots:41 },
    { id:10, name:'Bagalkot',          ...DIST_COORDS['Bagalkot'],          murder:6,  dacoity:0, robbery:1,  theft:52,  cyber:3,   ndps:37,  pocso:11, scst:18, hurt:95,  riots:65 },
    { id:11, name:'Raichur',           ...DIST_COORDS['Raichur'],           murder:0,  dacoity:0, robbery:0,  theft:38,  cyber:1,   ndps:23,  pocso:9,  scst:28, hurt:88,  riots:35 },
    { id:12, name:'Ballari',           ...DIST_COORDS['Ballari'],           murder:4,  dacoity:0, robbery:2,  theft:100, cyber:25,  ndps:24,  pocso:25, scst:57, hurt:135, riots:48 },
    { id:13, name:'Dharwad',           ...DIST_COORDS['Dharwad'],           murder:0,  dacoity:0, robbery:1,  theft:60,  cyber:9,   ndps:23,  pocso:11, scst:3,  hurt:118, riots:22 },
    { id:14, name:'Haveri',            ...DIST_COORDS['Haveri'],            murder:1,  dacoity:0, robbery:0,  theft:48,  cyber:5,   ndps:40,  pocso:12, scst:4,  hurt:50,  riots:14 },
    { id:15, name:'Hassan',            ...DIST_COORDS['Hassan'],            murder:1,  dacoity:1, robbery:0,  theft:65,  cyber:12,  ndps:24,  pocso:19, scst:11, hurt:120, riots:35 },
    { id:16, name:'Bidar',             ...DIST_COORDS['Bidar'],             murder:3,  dacoity:0, robbery:1,  theft:44,  cyber:5,   ndps:27,  pocso:19, scst:27, hurt:82,  riots:17 },
    { id:17, name:'Vijayapur',         ...DIST_COORDS['Vijayapur'],         murder:1,  dacoity:0, robbery:3,  theft:62,  cyber:14,  ndps:44,  pocso:14, scst:21, hurt:98,  riots:25 },
    { id:18, name:'Chitradurga',       ...DIST_COORDS['Chitradurga'],       murder:0,  dacoity:1, robbery:1,  theft:57,  cyber:9,   ndps:16,  pocso:12, scst:15, hurt:118, riots:31 },
    { id:19, name:'Chikkamagaluru',    ...DIST_COORDS['Chikkamagaluru'],    murder:1,  dacoity:1, robbery:0,  theft:52,  cyber:6,   ndps:22,  pocso:10, scst:2,  hurt:90,  riots:18 },
    { id:20, name:'Chickballapura',    ...DIST_COORDS['Chickballapura'],    murder:0,  dacoity:0, robbery:0,  theft:40,  cyber:6,   ndps:12,  pocso:14, scst:12, hurt:115, riots:24 },
    { id:21, name:'Dakshina Kannada',  ...DIST_COORDS['Dakshina Kannada'],  murder:2,  dacoity:0, robbery:1,  theft:78,  cyber:17,  ndps:21,  pocso:25, scst:5,  hurt:155, riots:22 },
    { id:22, name:'Gadag',             ...DIST_COORDS['Gadag'],             murder:0,  dacoity:0, robbery:0,  theft:35,  cyber:6,   ndps:18,  pocso:8,  scst:5,  hurt:55,  riots:15 },
    { id:23, name:'Kolar',             ...DIST_COORDS['Kolar'],             murder:0,  dacoity:0, robbery:1,  theft:48,  cyber:6,   ndps:11,  pocso:14, scst:14, hurt:95,  riots:21 },
    { id:24, name:'Koppal',            ...DIST_COORDS['Koppal'],            murder:1,  dacoity:1, robbery:0,  theft:30,  cyber:4,   ndps:16,  pocso:9,  scst:12, hurt:65,  riots:18 },
    { id:25, name:'Mandya',            ...DIST_COORDS['Mandya'],            murder:3,  dacoity:0, robbery:1,  theft:60,  cyber:6,   ndps:17,  pocso:16, scst:7,  hurt:135, riots:26 },
    { id:26, name:'Mysuru District',   ...DIST_COORDS['Mysuru District'],   murder:2,  dacoity:0, robbery:1,  theft:82,  cyber:12,  ndps:24,  pocso:25, scst:9,  hurt:148, riots:28 },
    { id:27, name:'Udupi',             ...DIST_COORDS['Udupi'],             murder:0,  dacoity:0, robbery:0,  theft:38,  cyber:12,  ndps:10,  pocso:8,  scst:1,  hurt:70,  riots:9  },
    { id:28, name:'Uttara Kannada',    ...DIST_COORDS['Uttara Kannada'],    murder:1,  dacoity:0, robbery:0,  theft:35,  cyber:6,   ndps:13,  pocso:10, scst:2,  hurt:60,  riots:11 },
    { id:29, name:'Yadgir',            ...DIST_COORDS['Yadgir'],            murder:0,  dacoity:0, robbery:0,  theft:26,  cyber:4,   ndps:18,  pocso:8,  scst:11, hurt:48,  riots:10 },
    { id:30, name:'Kodagu',            ...DIST_COORDS['Kodagu'],            murder:0,  dacoity:0, robbery:0,  theft:28,  cyber:6,   ndps:9,   pocso:5,  scst:1,  hurt:48,  riots:8  },
    { id:31, name:'K.G.F',             ...DIST_COORDS['K.G.F'],             murder:0,  dacoity:0, robbery:0,  theft:32,  cyber:4,   ndps:11,  pocso:7,  scst:6,  hurt:58,  riots:12 },
    { id:32, name:'Vijayanagara',      ...DIST_COORDS['Vijayanagara'],      murder:1,  dacoity:0, robbery:2,  theft:46,  cyber:7,   ndps:14,  pocso:10, scst:13, hurt:88,  riots:22 },
    { id:33, name:'Bengaluru South',   ...DIST_COORDS['Bengaluru South'],   murder:3,  dacoity:3, robbery:2,  theft:453, cyber:95,  ndps:17,  pocso:38, scst:9,  hurt:325, riots:36 },
    { id:34, name:'Bengaluru District',...DIST_COORDS['Bengaluru District'], murder:4,  dacoity:3, robbery:1,  theft:345, cyber:24,  ndps:17,  pocso:46, scst:14, hurt:278, riots:27 },
    { id:35, name:'Belagavi City',     ...DIST_COORDS['Belagavi City'],     murder:1,  dacoity:0, robbery:3,  theft:50,  cyber:8,   ndps:20,  pocso:10, scst:2,  hurt:88,  riots:42 },
    { id:36, name:'Kalaburagi City',   ...DIST_COORDS['Kalaburagi City'],   murder:1,  dacoity:0, robbery:0,  theft:22,  cyber:6,   ndps:5,   pocso:7,  scst:15, hurt:52,  riots:11 },
    { id:37, name:'Karnataka Railways',...DIST_COORDS['Karnataka Railways'], murder:0,  dacoity:0, robbery:0,  theft:24,  cyber:0,   ndps:7,   pocso:2,  scst:0,  hurt:16,  riots:2  },
    { id:38, name:'Kalaburagi',        ...DIST_COORDS['Kalaburagi'],        murder:1,  dacoity:0, robbery:0,  theft:35,  cyber:5,   ndps:22,  pocso:10, scst:26, hurt:82,  riots:16 },
  ],
  // Apr–Jun: use Jan data scaled by ratio (actual Apr/May/Jun district-level not in PDFs page 18)
  apr: [], may: [], jun: [],
}
// For Apr/May/Jun — use headline totals to scale Jan district proportions
const SCALE = { apr: 78/98, may: 94/98, jun: 113/98 }
;(['apr','may','jun'] as const).forEach(m => {
  const s = SCALE[m]
  DISTRICT_BY_MONTH[m] = DISTRICT_BY_MONTH.jan.map(d => ({
    ...d,
    murder:  Math.round(d.murder  * s),
    robbery: Math.round(d.robbery * s),
    theft:   Math.round(d.theft   * s),
    cyber:   Math.round(d.cyber   * (m==='jun'?0.73:m==='may'?0.75:0.74)),
    ndps:    Math.round(d.ndps    * (m==='jun'?0.88:m==='may'?0.58:0.67)),
    pocso:   Math.round(d.pocso   * (m==='jun'?1.18:m==='may'?1.28:1.25)),
    hurt:    Math.round(d.hurt    * (m==='jun'?1.09:m==='may'?1.19:1.22)),
    riots:   Math.round(d.riots   * (m==='jun'?1.19:m==='may'?1.20:1.07)),
  }))
})

const KSP_DISTRICTS = DISTRICT_BY_MONTH.jan  // default

type CrimeKey = 'murder' | 'dacoity' | 'robbery' | 'theft' | 'cyber' | 'ndps' | 'pocso' | 'scst' | 'hurt' | 'riots'

const CRIME_FILTERS: { key: CrimeKey | 'all'; label: string; color: string }[] = [
  { key: 'all',     label: 'All', color: '#6b7280' },
  { key: 'murder',  label: 'Murder', color: '#ef4444' },
  { key: 'theft',   label: 'Theft', color: '#3b82f6' },
  { key: 'cyber',   label: 'Cyber', color: '#06b6d4' },
  { key: 'ndps',    label: 'NDPS', color: '#a855f7' },
  { key: 'pocso',   label: 'POCSO', color: '#ec4899' },
  { key: 'robbery', label: 'Robbery', color: '#f97316' },
  { key: 'hurt',    label: 'Hurt', color: '#eab308' },
  { key: 'riots',   label: 'Riots', color: '#22c55e' },
]

const CRIME_META: Record<string, { label: string; ipc: string; color: string }> = {
  murder:  { label: 'Murder Cases',    ipc: 'Sec 302 IPC / 103 BNS',    color: '#ef4444' },
  dacoity: { label: 'Dacoity Cases',   ipc: 'Sec 395 IPC / 310 BNS',    color: '#dc2626' },
  robbery: { label: 'Robbery Cases',   ipc: 'Sec 392 IPC / 309 BNS',    color: '#f97316' },
  theft:   { label: 'Theft Cases',     ipc: 'Sec 379 IPC / 303 BNS',    color: '#3b82f6' },
  cyber:   { label: 'Cyber Crimes',    ipc: 'IT Act 2000',               color: '#06b6d4' },
  ndps:    { label: 'NDPS Cases',      ipc: 'NDPS Act 1985',             color: '#a855f7' },
  pocso:   { label: 'POCSO Cases',     ipc: 'POCSO Act 2012',            color: '#ec4899' },
  scst:    { label: 'SC/ST POA Cases', ipc: 'SC/ST POA Act 1989',        color: '#6366f1' },
  hurt:    { label: 'Hurt Cases',      ipc: 'Sec 323-335 IPC / 115 BNS', color: '#eab308' },
  riots:   { label: 'Riots Cases',     ipc: 'Sec 141-153 IPC / 189 BNS', color: '#22c55e' },
}

function getColor(value: number, max: number): string {
  const ratio = value / max
  if (ratio > 0.7) return '#ef4444'
  if (ratio > 0.4) return '#f97316'
  if (ratio > 0.15) return '#eab308'
  return '#22c55e'
}

function getRiskLevel(district: DistrictStats): { label: string; color: string } {
  const total = district.murder * 5 + district.robbery * 2 + district.dacoity * 3 + district.ndps + district.theft * 0.1
  if (total > 200) return { label: 'HIGH RISK', color: 'text-red-400' }
  if (total > 80)  return { label: 'MEDIUM RISK', color: 'text-yellow-400' }
  return { label: 'LOW RISK', color: 'text-green-400' }
}

interface DistrictPanelProps {
  district: DistrictStats
  monthLabel: string
  onClose: () => void
}

function DistrictPanel({ district, monthLabel, onClose }: DistrictPanelProps) {
  const risk = getRiskLevel(district)
  const crimes = Object.entries(CRIME_META).map(([key, meta]) => ({
    key, meta, count: district[key as CrimeKey] as number
  })).filter(c => c.count > 0).sort((a, b) => b.count - a.count)

  return (
    <div className="absolute top-4 right-4 w-80 bg-gray-950 border border-gray-700 rounded-2xl shadow-2xl z-10 overflow-hidden">
      {/* Header */}
      <div className="bg-gray-900 px-5 py-4 flex items-start justify-between border-b border-gray-800">
        <div>
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-blue-400" />
            <h3 className="text-sm font-bold text-white">{district.name}</h3>
          </div>
          <p className="text-xs text-gray-400 mt-0.5">Karnataka State Police — {monthLabel}</p>
          <span className={`text-xs font-bold mt-1 inline-block ${risk.color}`}>{risk.label}</span>
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-white p-1">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Crime list */}
      <div className="p-4 space-y-2 max-h-96 overflow-y-auto">
        <p className="text-xs text-gray-500 font-medium mb-3 uppercase tracking-wide">Cases Reported — {monthLabel}</p>
        {crimes.map(({ key, meta, count }) => (
          <div key={key} className="flex items-center justify-between py-2 border-b border-gray-800/60 last:border-0">
            <div className="min-w-0">
              <p className="text-xs font-medium text-white">{meta.label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{meta.ipc}</p>
            </div>
            <div className="flex items-center gap-2 ml-3 flex-shrink-0">
              <div className="w-16 bg-gray-800 rounded-full h-1.5">
                <div
                  className="h-1.5 rounded-full"
                  style={{ backgroundColor: meta.color, width: `${Math.min((count / 50) * 100, 100)}%` }}
                />
              </div>
              <span
                className="text-sm font-bold w-8 text-right"
                style={{ color: meta.color }}
              >
                {count}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Total */}
      <div className="px-5 py-3 bg-gray-900 border-t border-gray-800">
        <div className="flex justify-between text-xs">
          <span className="text-gray-400">Total cases (all heads)</span>
          <span className="text-white font-bold">
            {crimes.reduce((s, c) => s + c.count, 0)}
          </span>
        </div>
        <p className="text-xs text-gray-600 mt-1">Source: KSP CCTNS Monthly Review</p>
      </div>
    </div>
  )
}

interface HoverTooltipProps {
  district: DistrictStats
  activeFilter: CrimeKey | 'all'
}

function HoverTooltip({ district, activeFilter }: HoverTooltipProps) {
  // Show top 4 crime types on hover
  const crimes = Object.entries(CRIME_META)
    .map(([key, meta]) => ({ key, meta, count: district[key as CrimeKey] as number }))
    .filter(c => c.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 4)

  return (
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-gray-950 border border-gray-700 rounded-xl shadow-2xl pointer-events-none z-20">
      <div className="px-3 py-2 border-b border-gray-800">
        <p className="text-xs font-bold text-white">{district.name}</p>
        <p className="text-xs text-gray-500">Click for full details</p>
      </div>
      <div className="px-3 py-2 space-y-1">
        {crimes.map(({ key, meta, count }) => (
          <div key={key} className="flex justify-between text-xs">
            <span className="text-gray-400">{meta.label}</span>
            <span className="font-bold" style={{ color: meta.color }}>{count}</span>
          </div>
        ))}
      </div>
      {activeFilter !== 'all' && (
        <div className="px-3 py-1.5 bg-gray-900 rounded-b-xl border-t border-gray-800">
          <p className="text-xs text-gray-400">
            <span style={{ color: CRIME_META[activeFilter]?.color }}>
              {CRIME_META[activeFilter]?.label}:
            </span>{' '}
            <span className="text-white font-bold">{district[activeFilter as CrimeKey]}</span>
          </p>
        </div>
      )}
    </div>
  )
}

const MONTH_LABELS: Record<string, string> = {
  jan: 'January 2026', feb: 'February 2026', mar: 'March 2026',
  apr: 'April 2026',   may: 'May 2026',       jun: 'June 2026',
}

// ── Force map to re-render when month/filter changes ──────────
function MapUpdater({ districts, filter, maxVal, onSelect, selectedId }: {
  districts: DistrictStats[]
  filter: CrimeKey | 'all'
  maxVal: number
  onSelect: (id: number | null) => void
  selectedId: number | null
}) {
  const map = useMap()
  useEffect(() => {
    map.invalidateSize()
  }, [map, districts])
  return null
}

// ── Build a coloured DivIcon for each district ─────────────────
function makeIcon(color: string, val: number, label: string, selected: boolean) {
  const short = label
    .replace(' City', '').replace(' District', '').replace('-Dharwad', '')
    .split(' ').slice(0, 2).join(' ')
  const size = selected ? 44 : 36
  const html = `
    <div style="
      display:flex;align-items:center;gap:4px;
      background:${color};
      border:${selected ? '2px solid #fff' : '1.5px solid rgba(0,0,0,0.35)'};
      border-radius:8px;padding:3px 6px;
      box-shadow:0 2px 8px rgba(0,0,0,0.5);
      font-family:system-ui,sans-serif;font-size:10px;font-weight:700;
      color:#fff;white-space:nowrap;
      transform:${selected ? 'scale(1.2)' : 'scale(1)'};
      transform-origin:left center;
    ">
      <span>${short}</span>
      <span style="background:rgba(0,0,0,0.25);border-radius:4px;padding:0 4px;">${val}</span>
    </div>`
  return L.divIcon({ html, className: '', iconAnchor: [0, size / 2] })
}

export default function MapPage() {
  const [activeFilter, setActiveFilter] = useState<CrimeKey | 'all'>('all')
  const [selectedDistrict, setSelectedDistrict] = useState<number | null>(null)
  const [mapMonth, setMapMonth] = useState<string>('jan')

  const activeDistricts = DISTRICT_BY_MONTH[mapMonth]
  const monthLabel = MONTH_LABELS[mapMonth]
  const selectedData = activeDistricts.find(d => d.id === selectedDistrict) ?? null

  const maxVal = Math.max(...activeDistricts.map(d =>
    activeFilter === 'all'
      ? d.murder + d.theft + d.robbery + d.cyber
      : d[activeFilter as CrimeKey] as number
  ))

  const getVal = (d: DistrictStats) =>
    activeFilter === 'all' ? d.murder + d.theft + d.robbery + d.cyber : d[activeFilter as CrimeKey] as number

  return (
    <div className="flex flex-col h-full relative">

      {/* Controls */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-2.5 flex flex-col gap-2 flex-shrink-0">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-gray-500 mr-1">Month:</span>
          {Object.entries(MONTH_LABELS).map(([key, label]) => (
            <button key={key}
              onClick={() => { setMapMonth(key); setSelectedDistrict(null) }}
              className={`text-xs px-3 py-1 rounded-full transition-all border ${mapMonth === key ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'}`}>
              {label.split(' ')[0]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs text-gray-500 mr-1">Filter:</span>
          {CRIME_FILTERS.map(f => (
            <button key={f.key}
              onClick={() => setActiveFilter(f.key as CrimeKey | 'all')}
              className={`text-xs px-3 py-1 rounded-full transition-all border ${activeFilter === f.key ? 'text-white border-transparent' : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-white'}`}
              style={activeFilter === f.key ? { backgroundColor: f.color, borderColor: f.color } : {}}>
              {f.label}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2 text-xs text-gray-500">
            <TrendingUp className="h-3.5 w-3.5" />
            KSP CCTNS — {monthLabel} · Click marker = full details
          </div>
        </div>
      </div>

      {/* Leaflet Map */}
      <div className="flex-1 relative" style={{ minHeight: 0 }}>
        <style>{`
          .leaflet-container { background: #0f172a !important; }
          .leaflet-tile { filter: brightness(0.55) saturate(0.6) hue-rotate(180deg) invert(1); }
          .leaflet-control-zoom a { background:#1e293b!important;color:#94a3b8!important;border-color:#334155!important; }
          .leaflet-control-attribution { background:rgba(15,23,42,0.85)!important;color:#475569!important;font-size:9px; }
          .leaflet-popup-content-wrapper { background:#1e293b;border:1px solid #334155;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,0.6); }
          .leaflet-popup-tip { background:#1e293b; }
          .leaflet-popup-close-button { color:#94a3b8!important;font-size:16px!important; }
        `}</style>

        <MapContainer
          center={[15.3173, 75.7139]}
          zoom={7}
          style={{ width: '100%', height: '100%' }}
          zoomControl={true}
          scrollWheelZoom={true}
          attributionControl={true}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors'
            maxZoom={18}
          />

          <MapUpdater
            districts={activeDistricts}
            filter={activeFilter}
            maxVal={maxVal}
            onSelect={setSelectedDistrict}
            selectedId={selectedDistrict}
          />

          {activeDistricts.map(district => {
            const val = getVal(district)
            const color = getColor(val, maxVal)
            const isSelected = selectedDistrict === district.id
            const icon = makeIcon(color, val, district.name, isSelected)

            return (
              <Marker
                key={`${district.id}-${mapMonth}-${activeFilter}`}
                position={[district.lat, district.lng]}
                icon={icon}
                eventHandlers={{
                  click: () => setSelectedDistrict(district.id === selectedDistrict ? null : district.id),
                }}
              >
                <Popup minWidth={220} maxWidth={280}>
                  <div style={{ fontFamily: 'system-ui,sans-serif', color: '#e2e8f0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span style={{ color: '#60a5fa', fontSize: 13, fontWeight: 700 }}>{district.name}</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>
                      Karnataka State Police — {monthLabel}
                    </div>
                    {Object.entries(CRIME_META)
                      .map(([key, meta]) => ({ key, meta, count: district[key as CrimeKey] as number }))
                      .filter(c => c.count > 0)
                      .sort((a, b) => b.count - a.count)
                      .slice(0, 6)
                      .map(({ key, meta, count }) => (
                        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                          <span style={{ color: '#94a3b8' }}>{meta.label}</span>
                          <span style={{ color: meta.color, fontWeight: 700 }}>{count}</span>
                        </div>
                      ))
                    }
                  </div>
                </Popup>
              </Marker>
            )
          })}
        </MapContainer>

        {/* District detail panel */}
        {selectedData && (
          <DistrictPanel
            district={selectedData}
            monthLabel={monthLabel}
            onClose={() => setSelectedDistrict(null)}
          />
        )}
      </div>

      {/* Legend */}
      <div className="bg-gray-900 border-t border-gray-800 px-6 py-2 flex items-center gap-6 text-xs flex-shrink-0">
        <span className="text-gray-400 font-medium">Risk Level:</span>
        {[
          { color: '#ef4444', label: 'High' },
          { color: '#f97316', label: 'Medium-High' },
          { color: '#eab308', label: 'Medium' },
          { color: '#22c55e', label: 'Low' },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1.5 text-gray-400">
            <span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: color }} />
            {label}
          </span>
        ))}
        <span className="ml-auto text-gray-600">
          OpenStreetMap · Leaflet · {activeDistricts.length} districts · {monthLabel}
        </span>
      </div>
    </div>
  )
}
