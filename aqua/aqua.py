import requests
import json
from collections import defaultdict, deque
from math import sqrt
from time import time

AQUAURL=open('../.secrets/aqua_url.txt').read().strip()
USERNAME=open('../.secrets/aqua_username.txt').read().strip()
PASSWORD=open('../.secrets/aqua_password.txt').read().strip()

def aquaauth():
    res=requests.post(f"{AQUAURL}/token", {"username": USERNAME, "password": PASSWORD})
    j=json.loads(res.text)
    return {"Authorization": f"Bearer {j['access_token']}"}

AUTH_HDR = aquaauth()

def req_aqua(url):
    # Retry request with new authentication headers if the request fails
    try:
        res = requests.get(url, headers=AUTH_HDR)
    except Exception as e:
        AUTH_HDR = aquaauth()
        res = requests.get(url, headers=AUTH_HDR)
    
    return json.loads(res.text)

def _get_verse(id, b, c, v):
    res = req_aqua(f"{AQUAURL}/verse?revision_id={id}&book={b}&chapter={c}&verse={v}")
    return res[0]['text'].split('\t')[1].lower()

def get_greek(b, c, v):
    return _get_verse(22010, b, c, v)

def get_latin(b, c, v):
    return _get_verse(22011, b, c, v)

def ___safe_idx_loop(lst, elem, start_idx):
    idx = start_idx
    while idx >= 0:
        try:
            return lst.index(elem, idx)
        except ValueError:
            idx -= 1

def align_latin(b, c, v, vid, eflomal, gsplit, lsplit):
    res = req_aqua(f"{AQUAURL}/alignmentscores?assessment_id=24290&book={b}&chapter={c}&verse={v}&score_type=threshold")
    jr = res['results']
    jj = [_j for _j in jr if _j['source'] != _j['target']]

    # greek_v = get_greek(b, c, v)
    # latin_v = get_latin(b, c, v).split()

    # print(vid)
    # print(gsplit)
    # print(lsplit)

    lsorted = dict()
    ks_ctr = dict()
    ks_dict = dict()
    for j in sorted(jj, key=lambda x: x['source']):
        src = j['source']
        dst = j['target']
        conf_factor = j['score']
        ks = f"{src} {dst}"
        ids = eflomal.get(ks, None)
        
        # If eflomal doesn't have an alignment for this pair, patch the dictionary and search for all possible pairs in the result
        if ids is None:
            patch_ids = set()

            gct = gsplit.count(src)
            lct = lsplit.count(dst)

            # In rare cases, Aqua includes the verse number being aligned with a word in the gsplit or lsplit lists. We need to skip these cases.
            if src not in gsplit or dst not in lsplit:
                continue

            ct_lst = list(filter(lambda x: x['source'] == src and x['target'] == dst, jj))
            expected_ct = len(ct_lst)
            
            # Since we are iterating, there could be errors in the indices. If we find a mismatch, we should just dock the confidence score and default to the last found index
            # There will be at least one of the src and dst words in the gsplit and lsplit lists, and (ideally) exactly expected_ct instances of the pair
            # If there is a mismatch, default to the highest index of the word in the list
            if expected_ct != gct:
                conf_factor *= sqrt(((1/max(1, abs(gct-expected_ct)+1))))
            
            if expected_ct != lct:
                conf_factor *= sqrt(((1/max(1, abs(lct-expected_ct)+1))))
            
            conf_factor = round(conf_factor, 4)
            
            for idx in range(expected_ct):
                gid = ___safe_idx_loop(gsplit, src, idx)
                lid = ___safe_idx_loop(lsplit, dst, idx)
                patch_ids.add((gid, lid))
            
            ids = patch_ids
            eflomal.update({ks: ids})

        # Count unique pairs of words in the alignment.
        # The Aqua count will be considered authoritative, and we will need to either expand or shrink the eflomal-enriched pair list based on the Aqua count.
        if ks_ctr.get(ks) is None:
            ks_ctr[ks] = 0
        ks_ctr[ks] += 1

        # This ensures uniqueness
        sorted_ids = sorted(ids, key=lambda x: (x[1], x[0]))
        curr_idx = min(len(sorted_ids), ks_ctr[ks])-1
        g_id, l_id = sorted_ids[curr_idx]
        g_side = dict({g_id: conf_factor})

        if ks_dict.get(l_id) is None:
            ks_dict[l_id] = dict()
        ks_dict[l_id].update(g_side)
        
        # print(conf_factor, ks, ids)

    # Write out in whatever format
    for lidx, lword in enumerate(lsplit):
        gstrs = []

        for g_id, conf in sorted(ks_dict.get(lidx, {}).items(), key=lambda x: x[0]):
            gstrs.append(f"{int(vid)*1000 + g_id + 1} {gsplit[g_id]} {conf}")
        
        fstr = f"{lsplit[lidx]} - {' '.join(gstrs)}"
        with open(fout, "a") as f:
            f.write(fstr + "\n")
        # print(fstr)
    print(vid)

gtol = open("gtol.fwd").readlines()
ltog = open("ltog.rev").readlines()
greek = open("greek.txt", encoding='utf-8').readlines()
latin = open("latin.txt").readlines()
vreflist = open("ntvref.txt").readlines()
vrefids = open("vref_ids.txt").readlines()

fout = f"aqua{time()}.txt"
open(fout, "w")

__s = None#7783
__e = None#7788+31

for vref, fwd, rev, g, l, vid in list(zip(vreflist, gtol, ltog, greek, latin, vrefids))[__s:__e]:
    _tmp = vref[:-1].split(' ')
    book = _tmp[0]
    _cv = _tmp[1].split(':', 2)
    chap = int(_cv[0])
    verse = int(_cv[1])

    gsplit = g.lower().split()
    lsplit = l.lower().split()
    
    eflomal = dict()

    for lst in fwd, rev:
        for item in lst.split():
            ints = item.split('-', 2)
            # print(ints)
            src_idx = int(ints[0])
            dst_idx = int(ints[1])
            keystr = f"{gsplit[src_idx]} {lsplit[dst_idx]}".lower()

            if (eset := eflomal.get(keystr)) is None:
                eset = set()
            eset.add((src_idx, dst_idx))
            eflomal.update({keystr: eset})

    align_latin(book, chap, verse, vid, eflomal, gsplit, lsplit)
