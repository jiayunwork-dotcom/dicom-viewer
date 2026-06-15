use std::collections::HashSet;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use byteorder::{LittleEndian, BigEndian, ByteOrder};
use walkdir::WalkDir;
use crate::dicom;
use crate::dicom::{DicomTag, TransferSyntax, DicomParser, get_tag_value, encode_tag, write_tag, encode_tag_header};

fn get_tags_to_remove() -> HashSet<(u16, u16)> {
    let mut tags = HashSet::new();
    tags.insert((0x0008, 0x0014));
    tags.insert((0x0008, 0x0018));
    tags.insert((0x0008, 0x0050));
    tags.insert((0x0008, 0x0080));
    tags.insert((0x0008, 0x0081));
    tags.insert((0x0008, 0x0082));
    tags.insert((0x0008, 0x0083));
    tags.insert((0x0008, 0x0090));
    tags.insert((0x0008, 0x0092));
    tags.insert((0x0008, 0x0094));
    tags.insert((0x0008, 0x0100));
    tags.insert((0x0008, 0x0102));
    tags.insert((0x0008, 0x0104));
    tags.insert((0x0008, 0x1030));
    tags.insert((0x0008, 0x103E));
    tags.insert((0x0008, 0x1040));
    tags.insert((0x0008, 0x1048));
    tags.insert((0x0008, 0x1050));
    tags.insert((0x0008, 0x1060));
    tags.insert((0x0008, 0x1070));
    tags.insert((0x0008, 0x1080));
    tags.insert((0x0008, 0x1155));
    tags.insert((0x0008, 0x1195));
    tags.insert((0x0008, 0x4000));
    tags.insert((0x0010, 0x0010));
    tags.insert((0x0010, 0x0020));
    tags.insert((0x0010, 0x0030));
    tags.insert((0x0010, 0x0040));
    tags.insert((0x0010, 0x0050));
    tags.insert((0x0010, 0x0101));
    tags.insert((0x0010, 0x0110));
    tags.insert((0x0010, 0x1000));
    tags.insert((0x0010, 0x1001));
    tags.insert((0x0010, 0x1010));
    tags.insert((0x0010, 0x1020));
    tags.insert((0x0010, 0x1030));
    tags.insert((0x0010, 0x1040));
    tags.insert((0x0010, 0x1050));
    tags.insert((0x0010, 0x1060));
    tags.insert((0x0010, 0x1080));
    tags.insert((0x0010, 0x1090));
    tags.insert((0x0010, 0x2000));
    tags.insert((0x0010, 0x2100));
    tags.insert((0x0010, 0x2110));
    tags.insert((0x0010, 0x2150));
    tags.insert((0x0010, 0x2152));
    tags.insert((0x0010, 0x2154));
    tags.insert((0x0010, 0x2160));
    tags.insert((0x0010, 0x2180));
    tags.insert((0x0010, 0x21A0));
    tags.insert((0x0010, 0x21B0));
    tags.insert((0x0010, 0x21C0));
    tags.insert((0x0010, 0x21D0));
    tags.insert((0x0010, 0x21F0));
    tags.insert((0x0010, 0x2200));
    tags.insert((0x0010, 0x2210));
    tags.insert((0x0010, 0x4000));
    tags.insert((0x0018, 0x1030));
    tags.insert((0x0018, 0x4000));
    tags.insert((0x0020, 0x4000));
    tags.insert((0x0028, 0x4000));
    tags.insert((0x0032, 0x1032));
    tags.insert((0x0032, 0x1033));
    tags.insert((0x0032, 0x1060));
    tags.insert((0x0032, 0x4000));
    tags.insert((0x0038, 0x0000));
    tags.insert((0x0038, 0x0010));
    tags.insert((0x0038, 0x0011));
    tags.insert((0x0038, 0x0012));
    tags.insert((0x0038, 0x0013));
    tags.insert((0x0038, 0x0014));
    tags.insert((0x0038, 0x0015));
    tags.insert((0x0038, 0x0016));
    tags.insert((0x0038, 0x0017));
    tags.insert((0x0038, 0x0018));
    tags.insert((0x0038, 0x0019));
    tags.insert((0x0038, 0x001A));
    tags.insert((0x0038, 0x001B));
    tags.insert((0x0038, 0x001C));
    tags.insert((0x0038, 0x001D));
    tags.insert((0x0038, 0x001E));
    tags.insert((0x0038, 0x001F));
    tags.insert((0x0038, 0x0020));
    tags.insert((0x0038, 0x4000));
    tags.insert((0x0040, 0x0275));
    tags.insert((0x0040, 0x2017));
    tags.insert((0x0040, 0x4000));
    tags.insert((0x0040, 0xA730));
    tags.insert((0x0050, 0x0010));
    tags.insert((0x0060, 0x0010));
    tags.insert((0x0060, 0x0020));
    tags.insert((0x0060, 0x0030));
    tags.insert((0x0060, 0x0040));
    tags.insert((0x0060, 0x0050));
    tags.insert((0x0060, 0x0060));
    tags.insert((0x0060, 0x0070));
    tags.insert((0x0060, 0x0080));
    tags.insert((0x0060, 0x0090));
    tags.insert((0x0060, 0x00A0));
    tags.insert((0x0060, 0x00B0));
    tags.insert((0x0060, 0x00C0));
    tags.insert((0x0060, 0x00D0));
    tags.insert((0x0060, 0x00E0));
    tags.insert((0x0060, 0x00F0));
    tags.insert((0x0060, 0x0100));
    tags.insert((0x0060, 0x0101));
    tags.insert((0x0060, 0x0102));
    tags.insert((0x0060, 0x0103));
    tags.insert((0x0060, 0x0104));
    tags.insert((0x0060, 0x0105));
    tags.insert((0x0060, 0x0106));
    tags.insert((0x0060, 0x0107));
    tags.insert((0x0060, 0x0108));
    tags.insert((0x0060, 0x0109));
    tags.insert((0x0060, 0x010A));
    tags.insert((0x0060, 0x010B));
    tags.insert((0x0060, 0x010C));
    tags.insert((0x0060, 0x010D));
    tags.insert((0x0060, 0x010E));
    tags.insert((0x0060, 0x010F));
    tags.insert((0x0060, 0x0110));
    tags.insert((0x0060, 0x0111));
    tags.insert((0x0060, 0x0112));
    tags.insert((0x0060, 0x0113));
    tags.insert((0x0060, 0x0114));
    tags.insert((0x0060, 0x0115));
    tags.insert((0x0060, 0x0116));
    tags.insert((0x0060, 0x0117));
    tags.insert((0x0060, 0x0118));
    tags.insert((0x0060, 0x0119));
    tags.insert((0x0060, 0x011A));
    tags.insert((0x0060, 0x011B));
    tags.insert((0x0060, 0x011C));
    tags.insert((0x0060, 0x011D));
    tags.insert((0x0060, 0x011E));
    tags.insert((0x0060, 0x011F));
    tags.insert((0x0060, 0x0120));
    tags.insert((0x0060, 0x0121));
    tags.insert((0x0060, 0x0122));
    tags.insert((0x0060, 0x0123));
    tags.insert((0x0060, 0x0124));
    tags.insert((0x0060, 0x0125));
    tags.insert((0x0060, 0x0126));
    tags.insert((0x0060, 0x0127));
    tags.insert((0x0060, 0x0128));
    tags.insert((0x0060, 0x0129));
    tags.insert((0x0060, 0x012A));
    tags.insert((0x0060, 0x012B));
    tags.insert((0x0060, 0x012C));
    tags.insert((0x0060, 0x012D));
    tags.insert((0x0060, 0x012E));
    tags.insert((0x0060, 0x012F));
    tags.insert((0x0060, 0x0130));
    tags.insert((0x0060, 0x0131));
    tags.insert((0x0060, 0x0132));
    tags.insert((0x0060, 0x0133));
    tags.insert((0x0060, 0x0134));
    tags.insert((0x0060, 0x0135));
    tags.insert((0x0060, 0x0136));
    tags.insert((0x0060, 0x0137));
    tags.insert((0x0060, 0x0138));
    tags.insert((0x0060, 0x0139));
    tags.insert((0x0060, 0x013A));
    tags.insert((0x0060, 0x013B));
    tags.insert((0x0060, 0x013C));
    tags.insert((0x0060, 0x013D));
    tags.insert((0x0060, 0x013E));
    tags.insert((0x0060, 0x013F));
    tags.insert((0x0060, 0x0140));
    tags.insert((0x0060, 0x0141));
    tags.insert((0x0060, 0x0142));
    tags.insert((0x0060, 0x0143));
    tags.insert((0x0060, 0x0144));
    tags.insert((0x0060, 0x0145));
    tags.insert((0x0060, 0x0146));
    tags.insert((0x0060, 0x0147));
    tags.insert((0x0060, 0x0148));
    tags.insert((0x0060, 0x0149));
    tags.insert((0x0060, 0x014A));
    tags.insert((0x0060, 0x014B));
    tags.insert((0x0060, 0x014C));
    tags.insert((0x0060, 0x014D));
    tags.insert((0x0060, 0x014E));
    tags.insert((0x0060, 0x014F));
    tags.insert((0x0060, 0x0150));
    tags.insert((0x0060, 0x0151));
    tags.insert((0x0060, 0x0152));
    tags.insert((0x0060, 0x0153));
    tags.insert((0x0060, 0x0154));
    tags.insert((0x0060, 0x0155));
    tags.insert((0x0060, 0x0156));
    tags.insert((0x0060, 0x0157));
    tags.insert((0x0060, 0x0158));
    tags.insert((0x0060, 0x0159));
    tags.insert((0x0060, 0x015A));
    tags.insert((0x0060, 0x015B));
    tags.insert((0x0060, 0x015C));
    tags.insert((0x0060, 0x015D));
    tags.insert((0x0060, 0x015E));
    tags.insert((0x0060, 0x015F));
    tags.insert((0x0060, 0x0160));
    tags.insert((0x0060, 0x0161));
    tags.insert((0x0060, 0x0162));
    tags.insert((0x0060, 0x0163));
    tags.insert((0x0060, 0x0164));
    tags.insert((0x0060, 0x0165));
    tags.insert((0x0060, 0x0166));
    tags.insert((0x0060, 0x0167));
    tags.insert((0x0060, 0x0168));
    tags.insert((0x0060, 0x0169));
    tags.insert((0x0060, 0x016A));
    tags.insert((0x0060, 0x016B));
    tags.insert((0x0060, 0x016C));
    tags.insert((0x0060, 0x016D));
    tags.insert((0x0060, 0x016E));
    tags.insert((0x0060, 0x016F));
    tags.insert((0x0060, 0x0170));
    tags.insert((0x0060, 0x0171));
    tags.insert((0x0060, 0x0172));
    tags.insert((0x0060, 0x0173));
    tags.insert((0x0060, 0x0174));
    tags.insert((0x0060, 0x0175));
    tags.insert((0x0060, 0x0176));
    tags.insert((0x0060, 0x0177));
    tags.insert((0x0060, 0x0178));
    tags.insert((0x0060, 0x0179));
    tags.insert((0x0060, 0x017A));
    tags.insert((0x0060, 0x017B));
    tags.insert((0x0060, 0x017C));
    tags.insert((0x0060, 0x017D));
    tags.insert((0x0060, 0x017E));
    tags.insert((0x0060, 0x017F));
    tags.insert((0x0060, 0x0180));
    tags.insert((0x0060, 0x0181));
    tags.insert((0x0060, 0x0182));
    tags.insert((0x0060, 0x0183));
    tags.insert((0x0060, 0x0184));
    tags.insert((0x0060, 0x0185));
    tags.insert((0x0060, 0x0186));
    tags.insert((0x0060, 0x0187));
    tags.insert((0x0060, 0x0188));
    tags.insert((0x0060, 0x0189));
    tags.insert((0x0060, 0x018A));
    tags.insert((0x0060, 0x018B));
    tags.insert((0x0060, 0x018C));
    tags.insert((0x0060, 0x018D));
    tags.insert((0x0060, 0x018E));
    tags.insert((0x0060, 0x018F));
    tags.insert((0x0060, 0x0190));
    tags.insert((0x0060, 0x0191));
    tags.insert((0x0060, 0x0192));
    tags.insert((0x0060, 0x0193));
    tags.insert((0x0060, 0x0194));
    tags.insert((0x0060, 0x0195));
    tags.insert((0x0060, 0x0196));
    tags.insert((0x0060, 0x0197));
    tags.insert((0x0060, 0x0198));
    tags.insert((0x0060, 0x0199));
    tags.insert((0x0060, 0x019A));
    tags.insert((0x0060, 0x019B));
    tags.insert((0x0060, 0x019C));
    tags.insert((0x0060, 0x019D));
    tags.insert((0x0060, 0x019E));
    tags.insert((0x0060, 0x019F));
    tags.insert((0x0060, 0x0200));
    tags.insert((0x0060, 0x0201));
    tags.insert((0x0060, 0x0202));
    tags.insert((0x0060, 0x0203));
    tags.insert((0x0060, 0x0204));
    tags.insert((0x0060, 0x0205));
    tags.insert((0x0060, 0x0206));
    tags.insert((0x0060, 0x0207));
    tags.insert((0x0060, 0x0208));
    tags.insert((0x0060, 0x0209));
    tags.insert((0x0060, 0x020A));
    tags.insert((0x0060, 0x020B));
    tags.insert((0x0060, 0x020C));
    tags.insert((0x0060, 0x020D));
    tags.insert((0x0060, 0x020E));
    tags.insert((0x0060, 0x020F));
    tags.insert((0x0060, 0x0210));
    tags.insert((0x0060, 0x0211));
    tags.insert((0x0060, 0x0212));
    tags.insert((0x0060, 0x0213));
    tags.insert((0x0060, 0x0214));
    tags.insert((0x0060, 0x0215));
    tags.insert((0x0060, 0x0216));
    tags.insert((0x0060, 0x0217));
    tags.insert((0x0060, 0x0218));
    tags.insert((0x0060, 0x0219));
    tags.insert((0x0060, 0x021A));
    tags.insert((0x0060, 0x021B));
    tags.insert((0x0060, 0x021C));
    tags.insert((0x0060, 0x021D));
    tags.insert((0x0060, 0x021E));
    tags.insert((0x0060, 0x021F));
    tags.insert((0x0060, 0x0220));
    tags.insert((0x0060, 0x0221));
    tags.insert((0x0060, 0x0222));
    tags.insert((0x0060, 0x0223));
    tags.insert((0x0060, 0x0224));
    tags.insert((0x0060, 0x0225));
    tags.insert((0x0060, 0x0226));
    tags.insert((0x0060, 0x0227));
    tags.insert((0x0060, 0x0228));
    tags.insert((0x0060, 0x0229));
    tags.insert((0x0060, 0x022A));
    tags.insert((0x0060, 0x022B));
    tags.insert((0x0060, 0x022C));
    tags.insert((0x0060, 0x022D));
    tags.insert((0x0060, 0x022E));
    tags.insert((0x0060, 0x022F));
    tags.insert((0x0060, 0x0230));
    tags.insert((0x0060, 0x0231));
    tags.insert((0x0060, 0x0232));
    tags.insert((0x0060, 0x0233));
    tags.insert((0x0060, 0x0234));
    tags.insert((0x0060, 0x0235));
    tags.insert((0x0060, 0x0236));
    tags.insert((0x0060, 0x0237));
    tags.insert((0x0060, 0x0238));
    tags.insert((0x0060, 0x0239));
    tags.insert((0x0060, 0x023A));
    tags.insert((0x0060, 0x023B));
    tags.insert((0x0060, 0x023C));
    tags.insert((0x0060, 0x023D));
    tags.insert((0x0060, 0x023E));
    tags.insert((0x0060, 0x023F));
    tags.insert((0x0060, 0x0240));
    tags.insert((0x0060, 0x0241));
    tags.insert((0x0060, 0x0242));
    tags.insert((0x0060, 0x0243));
    tags.insert((0x0060, 0x0244));
    tags.insert((0x0060, 0x0245));
    tags.insert((0x0060, 0x0246));
    tags.insert((0x0060, 0x0247));
    tags.insert((0x0060, 0x0248));
    tags.insert((0x0060, 0x0249));
    tags.insert((0x0060, 0x024A));
    tags.insert((0x0060, 0x024B));
    tags.insert((0x0060, 0x024C));
    tags.insert((0x0060, 0x024D));
    tags.insert((0x0060, 0x024E));
    tags.insert((0x0060, 0x024F));
    tags.insert((0x0060, 0x0250));
    tags.insert((0x0060, 0x0251));
    tags.insert((0x0060, 0x0252));
    tags.insert((0x0060, 0x0253));
    tags.insert((0x0060, 0x0254));
    tags.insert((0x0060, 0x0255));
    tags.insert((0x0060, 0x0256));
    tags.insert((0x0060, 0x0257));
    tags.insert((0x0060, 0x0258));
    tags.insert((0x0060, 0x0259));
    tags.insert((0x0060, 0x025A));
    tags.insert((0x0060, 0x025B));
    tags.insert((0x0060, 0x025C));
    tags.insert((0x0060, 0x025D));
    tags.insert((0x0060, 0x025E));
    tags.insert((0x0060, 0x025F));
    tags.insert((0x0060, 0x0260));
    tags.insert((0x0060, 0x0261));
    tags.insert((0x0060, 0x0262));
    tags.insert((0x0060, 0x0263));
    tags.insert((0x0060, 0x0264));
    tags.insert((0x0060, 0x0265));
    tags.insert((0x0060, 0x0266));
    tags.insert((0x0060, 0x0267));
    tags.insert((0x0060, 0x0268));
    tags.insert((0x0060, 0x0269));
    tags.insert((0x0060, 0x026A));
    tags.insert((0x0060, 0x026B));
    tags.insert((0x0060, 0x026C));
    tags.insert((0x0060, 0x026D));
    tags.insert((0x0060, 0x026E));
    tags.insert((0x0060, 0x026F));
    tags.insert((0x0060, 0x0270));
    tags.insert((0x0060, 0x0271));
    tags.insert((0x0060, 0x0272));
    tags.insert((0x0060, 0x0273));
    tags.insert((0x0060, 0x0274));
    tags.insert((0x0060, 0x0275));
    tags.insert((0x0060, 0x0276));
    tags.insert((0x0060, 0x0277));
    tags.insert((0x0060, 0x0278));
    tags.insert((0x0060, 0x0279));
    tags.insert((0x0060, 0x027A));
    tags.insert((0x0060, 0x027B));
    tags.insert((0x0060, 0x027C));
    tags.insert((0x0060, 0x027D));
    tags.insert((0x0060, 0x027E));
    tags.insert((0x0060, 0x027F));
    tags.insert((0x0060, 0x0280));
    tags.insert((0x0060, 0x0281));
    tags.insert((0x0060, 0x0282));
    tags.insert((0x0060, 0x0283));
    tags.insert((0x0060, 0x0284));
    tags.insert((0x0060, 0x0285));
    tags.insert((0x0060, 0x0286));
    tags.insert((0x0060, 0x0287));
    tags.insert((0x0060, 0x0288));
    tags.insert((0x0060, 0x0289));
    tags.insert((0x0060, 0x028A));
    tags.insert((0x0060, 0x028B));
    tags.insert((0x0060, 0x028C));
    tags.insert((0x0060, 0x028D));
    tags.insert((0x0060, 0x028E));
    tags.insert((0x0060, 0x028F));
    tags.insert((0x0060, 0x0290));
    tags.insert((0x0060, 0x0291));
    tags.insert((0x0060, 0x0292));
    tags.insert((0x0060, 0x0293));
    tags.insert((0x0060, 0x0294));
    tags.insert((0x0060, 0x0295));
    tags.insert((0x0060, 0x0296));
    tags.insert((0x0060, 0x0297));
    tags.insert((0x0060, 0x0298));
    tags.insert((0x0060, 0x0299));
    tags.insert((0x0060, 0x029A));
    tags.insert((0x0060, 0x029B));
    tags.insert((0x0060, 0x029C));
    tags.insert((0x0060, 0x029D));
    tags.insert((0x0060, 0x029E));
    tags.insert((0x0060, 0x029F));
    tags.insert((0x0060, 0x0300));
    tags.insert((0x0060, 0x0301));
    tags.insert((0x0060, 0x0302));
    tags.insert((0x0060, 0x0303));
    tags.insert((0x0060, 0x0304));
    tags.insert((0x0060, 0x0305));
    tags.insert((0x0060, 0x0306));
    tags.insert((0x0060, 0x0307));
    tags.insert((0x0060, 0x0308));
    tags.insert((0x0060, 0x0309));
    tags.insert((0x0060, 0x030A));
    tags.insert((0x0060, 0x030B));
    tags.insert((0x0060, 0x030C));
    tags.insert((0x0060, 0x030D));
    tags.insert((0x0060, 0x030E));
    tags.insert((0x0060, 0x030F));
    tags.insert((0x0060, 0x0310));
    tags.insert((0x0060, 0x0311));
    tags.insert((0x0060, 0x0312));
    tags.insert((0x0060, 0x0313));
    tags.insert((0x0060, 0x0314));
    tags.insert((0x0060, 0x0315));
    tags.insert((0x0060, 0x0316));
    tags.insert((0x0060, 0x0317));
    tags.insert((0x0060, 0x0318));
    tags.insert((0x0060, 0x0319));
    tags.insert((0x0060, 0x031A));
    tags.insert((0x0060, 0x031B));
    tags.insert((0x0060, 0x031C));
    tags.insert((0x0060, 0x031D));
    tags.insert((0x0060, 0x031E));
    tags.insert((0x0060, 0x031F));
    tags.insert((0x0060, 0x0320));
    tags.insert((0x0060, 0x0321));
    tags.insert((0x0060, 0x0322));
    tags.insert((0x0060, 0x0323));
    tags.insert((0x0060, 0x0324));
    tags.insert((0x0060, 0x0325));
    tags.insert((0x0060, 0x0326));
    tags.insert((0x0060, 0x0327));
    tags.insert((0x0060, 0x0328));
    tags.insert((0x0060, 0x0329));
    tags.insert((0x0060, 0x032A));
    tags.insert((0x0060, 0x032B));
    tags.insert((0x0060, 0x032C));
    tags.insert((0x0060, 0x032D));
    tags.insert((0x0060, 0x032E));
    tags.insert((0x0060, 0x032F));
    tags.insert((0x0060, 0x0330));
    tags.insert((0x0060, 0x0331));
    tags.insert((0x0060, 0x0332));
    tags.insert((0x0060, 0x0333));
    tags.insert((0x0060, 0x0334));
    tags.insert((0x0060, 0x0335));
    tags.insert((0x0060, 0x0336));
    tags.insert((0x0060, 0x0337));
    tags.insert((0x0060, 0x0338));
    tags.insert((0x0060, 0x0339));
    tags.insert((0x0060, 0x033A));
    tags.insert((0x0060, 0x033B));
    tags.insert((0x0060, 0x033C));
    tags.insert((0x0060, 0x033D));
    tags.insert((0x0060, 0x033E));
    tags.insert((0x0060, 0x033F));
    tags.insert((0x0060, 0x0340));
    tags.insert((0x0060, 0x0341));
    tags.insert((0x0060, 0x0342));
    tags.insert((0x0060, 0x0343));
    tags.insert((0x0060, 0x0344));
    tags.insert((0x0060, 0x0345));
    tags.insert((0x0060, 0x0346));
    tags.insert((0x0060, 0x0347));
    tags.insert((0x0060, 0x0348));
    tags.insert((0x0060, 0x0349));
    tags.insert((0x0060, 0x034A));
    tags.insert((0x0060, 0x034B));
    tags.insert((0x0060, 0x034C));
    tags.insert((0x0060, 0x034D));
    tags.insert((0x0060, 0x034E));
    tags.insert((0x0060, 0x034F));
    tags.insert((0x0060, 0x0350));
    tags.insert((0x0060, 0x0351));
    tags.insert((0x0060, 0x0352));
    tags.insert((0x0060, 0x0353));
    tags.insert((0x0060, 0x0354));
    tags.insert((0x0060, 0x0355));
    tags.insert((0x0060, 0x0356));
    tags.insert((0x0060, 0x0357));
    tags.insert((0x0060, 0x0358));
    tags.insert((0x0060, 0x0359));
    tags.insert((0x0060, 0x035A));
    tags.insert((0x0060, 0x035B));
    tags.insert((0x0060, 0x035C));
    tags.insert((0x0060, 0x035D));
    tags.insert((0x0060, 0x035E));
    tags.insert((0x0060, 0x035F));
    tags.insert((0x0060, 0x0360));
    tags.insert((0x0060, 0x0361));
    tags.insert((0x0060, 0x0362));
    tags.insert((0x0060, 0x0363));
    tags.insert((0x0060, 0x0364));
    tags.insert((0x0060, 0x0365));
    tags.insert((0x0060, 0x0366));
    tags.insert((0x0060, 0x0367));
    tags.insert((0x0060, 0x0368));
    tags.insert((0x0060, 0x0369));
    tags.insert((0x0060, 0x036A));
    tags.insert((0x0060, 0x036B));
    tags.insert((0x0060, 0x036C));
    tags.insert((0x0060, 0x036D));
    tags.insert((0x0060, 0x036E));
    tags.insert((0x0060, 0x036F));
    tags.insert((0x0060, 0x0370));
    tags.insert((0x0060, 0x0371));
    tags.insert((0x0060, 0x0372));
    tags.insert((0x0060, 0x0373));
    tags.insert((0x0060, 0x0374));
    tags.insert((0x0060, 0x0375));
    tags.insert((0x0060, 0x0376));
    tags.insert((0x0060, 0x0377));
    tags.insert((0x0060, 0x0378));
    tags.insert((0x0060, 0x0379));
    tags.insert((0x0060, 0x037A));
    tags.insert((0x0060, 0x037B));
    tags.insert((0x0060, 0x037C));
    tags.insert((0x0060, 0x037D));
    tags.insert((0x0060, 0x037E));
    tags.insert((0x0060, 0x037F));
    tags.insert((0x0060, 0x0380));
    tags.insert((0x0060, 0x0381));
    tags.insert((0x0060, 0x0382));
    tags.insert((0x0060, 0x0383));
    tags.insert((0x0060, 0x0384));
    tags.insert((0x0060, 0x0385));
    tags.insert((0x0060, 0x0386));
    tags.insert((0x0060, 0x0387));
    tags.insert((0x0060, 0x0388));
    tags.insert((0x0060, 0x0389));
    tags.insert((0x0060, 0x038A));
    tags.insert((0x0060, 0x038B));
    tags.insert((0x0060, 0x038C));
    tags.insert((0x0060, 0x038D));
    tags.insert((0x0060, 0x038E));
    tags.insert((0x0060, 0x038F));
    tags.insert((0x0060, 0x0390));
    tags.insert((0x0060, 0x0391));
    tags.insert((0x0060, 0x0392));
    tags.insert((0x0060, 0x0393));
    tags.insert((0x0060, 0x0394));
    tags.insert((0x0060, 0x0395));
    tags.insert((0x0060, 0x0396));
    tags.insert((0x0060, 0x0397));
    tags.insert((0x0060, 0x0398));
    tags.insert((0x0060, 0x0399));
    tags.insert((0x0060, 0x039A));
    tags.insert((0x0060, 0x039B));
    tags.insert((0x0060, 0x039C));
    tags.insert((0x0060, 0x039D));
    tags.insert((0x0060, 0x039E));
    tags.insert((0x0060, 0x039F));
    tags.insert((0x0060, 0x0400));
    tags
}



fn anonymize_file_internal(input_path: &Path, output_path: &Path) -> Result<(), String> {
    let data = std::fs::read(input_path).map_err(|e| format!("Read error: {}", e))?;
    if data.len() < 132 || &data[128..132] != b"DICM" {
        return Err("Not a valid DICOM file".to_string());
    }

    let mut parser = DicomParser::new(data.clone());
    parser.pos = 132;
    let meta_tags = parser.parse_tags();

    let ts_uid = get_tag_value(&meta_tags, 0x0002, 0x0010).unwrap_or_else(|| "1.2.840.10008.1.2.1".to_string());
    let is_explicit = !matches!(ts_uid.as_str(), "1.2.840.10008.1.2");
    let big_endian = ts_uid == "1.2.840.10008.1.2.2";
    parser.transfer_syntax = match ts_uid.as_str() {
        "1.2.840.10008.1.2" => TransferSyntax::ImplicitVRLittleEndian,
        "1.2.840.10008.1.2.1" => TransferSyntax::ExplicitVRLittleEndian,
        "1.2.840.10008.1.2.2" => TransferSyntax::ExplicitVRBigEndian,
        _ => TransferSyntax::ExplicitVRLittleEndian,
    };

    let mut file_meta = Vec::new();
    file_meta.extend_from_slice(&[0u8; 128]);
    file_meta.extend_from_slice(b"DICM");

    for tag in &meta_tags {
        let keep = if tag.group == 0x0002 {
            tag.element != 0x0012 && tag.element != 0x0013
        } else {
            false
        };
        if keep {
            file_meta.extend(encode_tag(tag, true, false));
        }
    }

    let ts_tag = DicomTag {
        group: 0x0002,
        element: 0x0010,
        vr: "UI".to_string(),
        value: "1.2.840.10008.1.2.1".to_string(),
        ..Default::default()
    };
    file_meta.extend(encode_tag(&ts_tag, true, false));

    let uid_tag = DicomTag {
        group: 0x0002,
        element: 0x0002,
        vr: "UI".to_string(),
        value: "1.2.840.10008.1.3.10".to_string(),
        ..Default::default()
    };
    file_meta.extend(encode_tag(&uid_tag, true, false));

    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Create dir error: {}", e))?;
    }

    let mut out = File::create(output_path).map_err(|e| format!("Create file error: {}", e))?;
    out.write_all(&file_meta).map_err(|e| e.to_string())?;

    let data_start = parser.pos;
    let _ = anonymize_and_write_tags(
        &mut out,
        &[],
        &data,
        data_start,
        data.len(),
        is_explicit,
        big_endian,
        &ts_uid,
    ).map_err(|e| e.to_string())?;

    Ok(())
}

fn is_unsafe_tag(group: u16, element: u16) -> bool {
    if group == 0x0008 && (0x0012..=0x0014).contains(&element) {
        return false;
    }
    if group == 0x0008 && element == 0x0018 {
        return false;
    }
    if group == 0x0008 && element == 0x0019 {
        return false;
    }
    if group == 0x0008 && element == 0x0020 {
        return true;
    }
    if group == 0x0008 && element == 0x0030 {
        return true;
    }
    if group == 0x0008 && element == 0x0080 {
        return true;
    }
    if group == 0x0008 && element == 0x0081 {
        return true;
    }
    if group == 0x0008 && element == 0x0082 {
        return true;
    }
    if group == 0x0008 && element == 0x0083 {
        return true;
    }
    if group == 0x0008 && element == 0x0084 {
        return true;
    }
    if group == 0x0008 && element == 0x0085 {
        return true;
    }
    if group == 0x0008 && element == 0x0090 {
        return true;
    }
    if group == 0x0008 && element == 0x0092 {
        return true;
    }
    if group == 0x0008 && element == 0x0094 {
        return true;
    }
    if group == 0x0008 && element == 0x009C {
        return true;
    }
    if group == 0x0008 && element == 0x0104 {
        return true;
    }
    if group == 0x0008 && element == 0x0106 {
        return true;
    }
    if group == 0x0008 && element == 0x0201 {
        return true;
    }
    if group == 0x0008 && element == 0x1140 {
        return true;
    }
    if group == 0x0008 && element == 0x1155 {
        return true;
    }
    if group == 0x0008 && element == 0x1150 {
        return true;
    }
    if group == 0x0008 && element == 0x1152 {
        return true;
    }
    if group == 0x0008 && element == 0x2111 {
        return true;
    }
    if group == 0x0008 && element == 0x2112 {
        return true;
    }

    if group == 0x0010 {
        return true;
    }

    if group == 0x0018 && (0x1000..=0x100F).contains(&element) {
        return true;
    }
    if group == 0x0018 && element == 0x0010 {
        return true;
    }
    if group == 0x0018 && element == 0x0030 {
        return true;
    }

    if group == 0x0020 && element == 0x000D {
        return false;
    }
    if group == 0x0020 && element == 0x000E {
        return false;
    }
    if group == 0x0020 && element == 0x0010 {
        return false;
    }
    if group == 0x0020 && element == 0x0011 {
        return false;
    }
    if group == 0x0020 && element == 0x0012 {
        return false;
    }
    if group == 0x0020 && element == 0x0013 {
        return false;
    }
    if group == 0x0020 && element == 0x0052 {
        return true;
    }
    if group == 0x0020 && element == 0x000B {
        return false;
    }
    if group == 0x0020 && element == 0x9161 {
        return true;
    }
    if group == 0x0020 && element == 0x9164 {
        return true;
    }

    if group == 0x0020 && element == 0x000C {
        return false;
    }

    if group == 0x0029 && (0x1070..=0x109F).contains(&element) {
        return true;
    }

    if group == 0x0040 && element == 0x0275 {
        return true;
    }
    if group == 0x0040 && element == 0x0244 {
        return true;
    }
    if group == 0x0040 && element == 0x1001 {
        return true;
    }
    if group == 0x0040 && element == 0x1002 {
        return true;
    }
    if group == 0x0040 && element == 0x1003 {
        return true;
    }
    if group == 0x0040 && element == 0x1004 {
        return true;
    }
    if group == 0x0040 && element == 0x1005 {
        return true;
    }
    if group == 0x0040 && element == 0x1006 {
        return true;
    }
    if group == 0x0040 && element == 0x1007 {
        return true;
    }
    if group == 0x0040 && element == 0x1008 {
        return true;
    }
    if group == 0x0040 && element == 0x1009 {
        return true;
    }
    if group == 0x0040 && element == 0x100A {
        return true;
    }
    if group == 0x0040 && element == 0x100B {
        return true;
    }
    if group == 0x0040 && element == 0x100C {
        return true;
    }
    if group == 0x0040 && element == 0x100D {
        return true;
    }
    if group == 0x0040 && element == 0x100E {
        return true;
    }
    if group == 0x0040 && element == 0x100F {
        return true;
    }
    if group == 0x0040 && element == 0x1010 {
        return true;
    }
    if group == 0x0040 && element == 0x1011 {
        return true;
    }
    if group == 0x0040 && element == 0x1012 {
        return true;
    }
    if group == 0x0040 && element == 0x2004 {
        return true;
    }
    if group == 0x0040 && element == 0x2005 {
        return true;
    }
    if group == 0x0040 && element == 0x2006 {
        return true;
    }
    if group == 0x0040 && element == 0x2007 {
        return true;
    }
    if group == 0x0040 && element == 0x2008 {
        return true;
    }
    if group == 0x0040 && element == 0x2009 {
        return true;
    }
    if group == 0x0040 && element == 0x200A {
        return true;
    }
    if group == 0x0040 && element == 0x200B {
        return true;
    }
    if group == 0x0040 && element == 0x200C {
        return true;
    }
    if group == 0x0040 && element == 0x200D {
        return true;
    }
    if group == 0x0040 && element == 0x200E {
        return true;
    }
    if group == 0x0040 && element == 0x2016 {
        return true;
    }
    if group == 0x0040 && element == 0x2017 {
        return true;
    }
    if group == 0x0040 && element == 0x2018 {
        return true;
    }
    if group == 0x0040 && element == 0x2019 {
        return true;
    }
    if group == 0x0040 && element == 0x201A {
        return true;
    }
    if group == 0x0040 && element == 0x201B {
        return true;
    }
    if group == 0x0040 && element == 0x201C {
        return true;
    }
    if group == 0x0040 && element == 0x201D {
        return true;
    }
    if group == 0x0040 && element == 0x201E {
        return true;
    }
    if group == 0x0040 && element == 0x2022 {
        return true;
    }
    if group == 0x0040 && element == 0x2023 {
        return true;
    }
    if group == 0x0040 && element == 0x2027 {
        return true;
    }
    if group == 0x0040 && element == 0x2028 {
        return true;
    }
    if group == 0x0040 && element == 0x3001 {
        return true;
    }
    if group == 0x0040 && element == 0x3002 {
        return true;
    }

    if group == 0x0088 && element == 0x0140 {
        return true;
    }
    if group == 0x0088 && element == 0x0200 {
        return true;
    }
    if group == 0x0088 && element == 0x0910 {
        return true;
    }
    if group == 0x0088 && element == 0x0911 {
        return true;
    }
    if group == 0x0088 && element == 0x0912 {
        return true;
    }
    if group == 0x0088 && element == 0x0913 {
        return true;
    }
    if group == 0x0088 && element == 0x0914 {
        return true;
    }
    if group == 0x0088 && element == 0x0915 {
        return true;
    }
    if group == 0x0088 && element == 0x0920 {
        return true;
    }
    if group == 0x0088 && element == 0x0922 {
        return true;
    }
    if group == 0x0088 && element == 0x0923 {
        return true;
    }
    if group == 0x0088 && element == 0x0924 {
        return true;
    }
    if group == 0x0088 && element == 0x0925 {
        return true;
    }
    if group == 0x0088 && element == 0x0926 {
        return true;
    }
    if group == 0x0088 && element == 0x0930 {
        return true;
    }
    if group == 0x0088 && element == 0x0933 {
        return true;
    }
    if group == 0x0088 && element == 0x0935 {
        return true;
    }
    if group == 0x0088 && element == 0x0936 {
        return true;
    }
    if group == 0x0088 && element == 0x0937 {
        return true;
    }
    if group == 0x0088 && element == 0x0938 {
        return true;
    }
    if group == 0x0088 && element == 0x0939 {
        return true;
    }
    if group == 0x0088 && element == 0x093A {
        return true;
    }
    if group == 0x0088 && element == 0x0940 {
        return true;
    }

    if (0x0800..=0x0FFF).contains(&group) {
        return true;
    }

    if (0x5000..=0x50FF).contains(&group) {
        if (0x0100..=0x01FF).contains(&element) {
            return true;
        }
        if (0x0200..=0x02FF).contains(&element) {
            return true;
        }
        if (0x0300..=0x03FF).contains(&element) {
            return true;
        }
        if (0x1000..=0x10FF).contains(&element) {
            return true;
        }
        if (0x2000..=0x20FF).contains(&element) {
            return true;
        }
        if (0x3000..=0x30FF).contains(&element) {
            return true;
        }
    }

    if (0x6000..=0x60FF).contains(&group) && (element & 0xFF00 == 0x3000) {
        return true;
    }
    if (0x6000..=0x60FF).contains(&group) && (element & 0xFF00 == 0x4000) {
        return true;
    }

    if group == 0x7FE0 && element == 0x00FF {
        return true;
    }

    if group & 0xFF01 == 0x0001 && group >= 0x0002 {
        return true;
    }

    if group == 0x0002 {
        return false;
    }

    false
}

fn anonymize_and_write_tags(
    out: &mut File,
    meta_tags: &[DicomTag],
    data: &[u8],
    mut pos: usize,
    end: usize,
    is_explicit: bool,
    big_endian: bool,
    ts_uid: &str,
) -> std::io::Result<usize> {
    let mut written = 0usize;

    for tag in meta_tags {
        written += write_tag(out, tag, is_explicit, big_endian)?;
    }

    while pos < end {
        if pos + 4 > data.len() {
            break;
        }
        let group = if big_endian { BigEndian::read_u16(&data[pos..pos + 2]) } else { LittleEndian::read_u16(&data[pos..pos + 2]) };
        let element = if big_endian { BigEndian::read_u16(&data[pos + 2..pos + 4]) } else { LittleEndian::read_u16(&data[pos + 2..pos + 4]) };
        pos += 4;

        if group == 0xFFFE && (element == 0xE00D || element == 0xE0DD) {
            if pos + 4 > data.len() {
                break;
            }
            let item_len = if big_endian { BigEndian::read_u32(&data[pos..pos + 4]) } else { LittleEndian::read_u32(&data[pos..pos + 4]) };
            pos += 4;
            out.write_all(&0xFFFEu16.to_le_bytes())?;
            out.write_all(&element.to_le_bytes())?;
            out.write_all(&item_len.to_le_bytes())?;
            written += 8;
            break;
        }

        let (vr, mut length) = if is_explicit {
            if pos + 2 > data.len() {
                break;
            }
            let vr_bytes = &data[pos..pos + 2];
            let vr = String::from_utf8_lossy(vr_bytes).to_string();
            pos += 2;
            let len = if vr == "OB" || vr == "OW" || vr == "OF" || vr == "SQ" || vr == "UT" || vr == "UN" {
                if pos + 2 > data.len() {
                    break;
                }
                let _reserved = [data[pos], data[pos + 1]];
                pos += 2;
                if pos + 4 > data.len() {
                    break;
                }
                if big_endian { BigEndian::read_u32(&data[pos..pos + 4]) } else { LittleEndian::read_u32(&data[pos..pos + 4]) }
            } else {
                if pos + 2 > data.len() {
                    break;
                }
                if big_endian { BigEndian::read_u16(&data[pos..pos + 2]) as u32 } else { LittleEndian::read_u16(&data[pos..pos + 2]) as u32 }
            };
            pos += if vr == "OB" || vr == "OW" || vr == "OF" || vr == "SQ" || vr == "UT" || vr == "UN" { 4 } else { 2 };
            (vr, len)
        } else {
            ("OW".to_string(), if big_endian { BigEndian::read_u32(&data[pos..pos + 4]) } else { LittleEndian::read_u32(&data[pos..pos + 4]) })
        };

        let is_unsafe = is_unsafe_tag(group, element);

        if is_unsafe && vr != "SQ" {
            let new_value: Vec<u8> = if vr == "LO" || vr == "PN" || vr == "SH" || vr == "ST" || vr == "LT" || vr == "UT" || vr == "CS" || vr == "AE" || vr == "DA" || vr == "TM" || vr == "DT" {
                let mut v = b"Anonymized".to_vec();
                if !v.is_empty() && v.len() % 2 != 0 {
                    v.push(b' ');
                }
                v
            } else if vr == "UI" {
                let mut v = b"1.2.840.10008.1.2.3.4.5.6.7.8.9.10".to_vec();
                if v.len() % 2 != 0 {
                    v.push(0x00);
                }
                v
            } else if vr == "OB" {
                vec![0u8; 0]
            } else if vr == "OW" {
                vec![0u8; 0]
            } else if vr == "US" {
                vec![0u8; 2]
            } else if vr == "UL" {
                vec![0u8; 4]
            } else if vr == "SS" {
                vec![0u8; 2]
            } else if vr == "SL" {
                vec![0u8; 4]
            } else if vr == "FL" {
                vec![0u8; 4]
            } else if vr == "FD" {
                vec![0u8; 8]
            } else if vr == "IS" {
                b"0".to_vec()
            } else if vr == "AS" {
                b"000Y".to_vec()
            } else {
                vec![0u8; 0]
            };

            let new_len = new_value.len() as u32;
            let tag_bytes = encode_tag_header(group, element, &vr, new_len, is_explicit, big_endian);
            out.write_all(&tag_bytes)?;
            out.write_all(&new_value)?;
            written += tag_bytes.len() + new_value.len();
            pos = if length == 0xFFFFFFFF { data.len() } else { pos + length as usize };
            continue;
        }

        if vr == "SQ" || (group == 0xFFFE && element == 0xE000) {
            out.write_all(&group.to_le_bytes())?;
            out.write_all(&element.to_le_bytes())?;
            written += 4;

            if is_explicit {
                out.write_all(vr.as_bytes())?;
                written += 2;
                if vr == "OB" || vr == "OW" || vr == "OF" || vr == "SQ" || vr == "UT" || vr == "UN" {
                    out.write_all(&[0u8, 0u8])?;
                    out.write_all(&0xFFFFFFFFu32.to_le_bytes())?;
                    written += 6;
                } else {
                    out.write_all(&0xFFFFu16.to_le_bytes())?;
                    written += 2;
                }
            } else {
                out.write_all(&0xFFFFFFFFu32.to_le_bytes())?;
                written += 4;
            }

            let sq_end = if length == 0xFFFFFFFF {
                let mut depth = 1i32;
                let mut p = pos;
                while p + 8 <= data.len() && depth > 0 {
                    let g = if big_endian { BigEndian::read_u16(&data[p..p + 2]) } else { LittleEndian::read_u16(&data[p..p + 2]) };
                    let e = if big_endian { BigEndian::read_u16(&data[p + 2..p + 4]) } else { LittleEndian::read_u16(&data[p + 2..p + 4]) };
                    let l = if big_endian { BigEndian::read_u32(&data[p + 4..p + 8]) } else { LittleEndian::read_u32(&data[p + 4..p + 8]) };
                    if g == 0xFFFE && e == 0xE000 {
                        depth += 1;
                    } else if g == 0xFFFE && (e == 0xE00D || e == 0xE0DD) {
                        depth -= 1;
                    }
                    p += 8;
                    if l != 0xFFFFFFFF {
                        p = p.saturating_add(l as usize);
                    }
                }
                p
            } else {
                pos + length as usize
            };

            if group == 0xFFFE && element == 0xE000 {
                let item_data_end = if length == 0xFFFFFFFF { sq_end.saturating_sub(8) } else { sq_end };
                let w = anonymize_and_write_tags(
                    out,
                    &[],
                    data,
                    pos,
                    item_data_end,
                    is_explicit,
                    big_endian,
                    ts_uid,
                )?;
                written += w;
                pos = item_data_end;
            } else {
                let mut p = pos;
                while p + 8 <= sq_end {
                    let g = if big_endian { BigEndian::read_u16(&data[p..p + 2]) } else { LittleEndian::read_u16(&data[p..p + 2]) };
                    let e = if big_endian { BigEndian::read_u16(&data[p + 2..p + 4]) } else { LittleEndian::read_u16(&data[p + 2..p + 4]) };
                    let l = if big_endian { BigEndian::read_u32(&data[p + 4..p + 8]) } else { LittleEndian::read_u32(&data[p + 4..p + 8]) };
                    if g == 0xFFFE && e == 0xE000 {
                        out.write_all(&0xFFFEu16.to_le_bytes())?;
                        out.write_all(&0xE000u16.to_le_bytes())?;
                        out.write_all(&0xFFFFFFFFu32.to_le_bytes())?;
                        written += 8;
                        p += 8;
                        let item_end = if l == 0xFFFFFFFF {
                            let mut d = 1i32;
                            let mut pp = p;
                            while pp + 8 <= data.len() && d > 0 {
                                let gg = if big_endian { BigEndian::read_u16(&data[pp..pp + 2]) } else { LittleEndian::read_u16(&data[pp..pp + 2]) };
                                let ee = if big_endian { BigEndian::read_u16(&data[pp + 2..pp + 4]) } else { LittleEndian::read_u16(&data[pp + 2..pp + 4]) };
                                let ll = if big_endian { BigEndian::read_u32(&data[pp + 4..pp + 8]) } else { LittleEndian::read_u32(&data[pp + 4..pp + 8]) };
                                if gg == 0xFFFE && ee == 0xE000 {
                                    d += 1;
                                } else if gg == 0xFFFE && (ee == 0xE00D || ee == 0xE0DD) {
                                    d -= 1;
                                }
                                pp += 8;
                                if ll != 0xFFFFFFFF {
                                    pp = pp.saturating_add(ll as usize);
                                }
                            }
                            pp.saturating_sub(8)
                        } else {
                            p + l as usize
                        };
                        let w = anonymize_and_write_tags(
                            out,
                            &[],
                            data,
                            p,
                            item_end,
                            is_explicit,
                            big_endian,
                            ts_uid,
                        )?;
                        written += w;
                        out.write_all(&0xFFFEu16.to_le_bytes())?;
                        out.write_all(&0xE00Du16.to_le_bytes())?;
                        out.write_all(&0x00000000u32.to_le_bytes())?;
                        written += 8;
                        if l == 0xFFFFFFFF {
                            p = item_end + 8;
                        } else {
                            p = item_end;
                        }
                    } else if g == 0xFFFE && (e == 0xE00D || e == 0xE0DD) {
                        p += 8;
                        break;
                    } else {
                        break;
                    }
                }

                out.write_all(&0xFFFEu16.to_le_bytes())?;
                out.write_all(&0xE0DDu16.to_le_bytes())?;
                out.write_all(&0x00000000u32.to_le_bytes())?;
                written += 8;

                pos = sq_end;
            }
            continue;
        }

        let value_end = if length == 0xFFFFFFFF { data.len() } else { pos + length as usize };
        let value_end = value_end.min(data.len());
        if group == 0x7FE0 && element == 0x0010 {
            let mut actual_end = value_end;
            if length == 0xFFFFFFFF {
                let mut p = pos;
                while p + 8 <= data.len() {
                    let g = if big_endian { BigEndian::read_u16(&data[p..p + 2]) } else { LittleEndian::read_u16(&data[p..p + 2]) };
                    let e = if big_endian { BigEndian::read_u16(&data[p + 2..p + 4]) } else { LittleEndian::read_u16(&data[p + 2..p + 4]) };
                    let l = if big_endian { BigEndian::read_u32(&data[p + 4..p + 8]) } else { LittleEndian::read_u32(&data[p + 4..p + 8]) };
                    if g == 0xFFFE && (e == 0xE00D || e == 0xE0DD) {
                        actual_end = p + 8;
                        break;
                    }
                    p += 8;
                    if l != 0xFFFFFFFF {
                        p = p.saturating_add(l as usize);
                    }
                }
            }
            let tag_bytes = encode_tag_header(group, element, &vr, if length == 0xFFFFFFFF { 0xFFFFFFFF } else { (actual_end - pos) as u32 }, is_explicit, big_endian);
            out.write_all(&tag_bytes)?;
            out.write_all(&data[pos..actual_end])?;
            written += tag_bytes.len() + (actual_end - pos);
            pos = actual_end;
            continue;
        }

        let raw_value = if value_end <= data.len() && pos <= value_end {
            &data[pos..value_end]
        } else {
            &[]
        };
        let tag_bytes = encode_tag_header(group, element, &vr, raw_value.len() as u32, is_explicit, big_endian);
        out.write_all(&tag_bytes)?;
        out.write_all(raw_value)?;
        written += tag_bytes.len() + raw_value.len();
        pos = value_end;
    }

    Ok(written)
}

#[tauri::command]
pub fn anonymize_dicom_file(input_path: String, output_path: String) -> Result<(), String> {
    anonymize_file_internal(Path::new(&input_path), Path::new(&output_path))
}

#[tauri::command]
pub fn anonymize_study(
    state: tauri::State<std::sync::Mutex<crate::AppState>>,
    study_uid: String,
    output_dir: String,
) -> Result<Vec<String>, String> {
    let state = state.lock().unwrap();
    let study = state.studies.get(&study_uid).ok_or("Study not found")?;

    std::fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;

    let mut output_files = Vec::new();
    for series in study.series.values() {
        for (i, instance) in series.instances.iter().enumerate() {
            let input_path = PathBuf::from(&instance.file_path);
            let filename = format!("anonymized_{}_{}.dcm", series.info.series_number, i);
            let output_path = PathBuf::from(&output_dir).join(filename);

            match anonymize_file_internal(&input_path, &output_path) {
                Ok(_) => output_files.push(output_path.to_string_lossy().to_string()),
                Err(e) => return Err(format!("Failed to anonymize {}: {}", input_path.display(), e)),
            }
        }
    }

    Ok(output_files)
}
