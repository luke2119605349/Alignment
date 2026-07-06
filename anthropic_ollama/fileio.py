import re
import icu

def sub_chunk(idict, s=None, e=None):
    return dict(list(idict.items())[s:e]).items()

def __ensure_verse(d, book, chap, verse):
    if d.get(book) is None:
        d.update({book: dict()})
    if d[book].get(chap) is None:
        d[book].update({chap: dict()})
    if d[book][chap].get(verse) is None:
        d[book][chap].update({verse: dict()})

# Removes accents and diacritics from Greek
def normalize_string(s):
    u = icu.UnicodeString(s)
    t = icu.Transliterator.createInstance("NFD; [:M:] Remove; NFC", icu.UTransDirection.FORWARD)
    t.transliterate(u)
    # Final sigma
    return re.sub(r'[^α-ωΑ-Ω 0-9]', r'', str(u).replace('ς', 'σ'))

# Parse Latin
def _open_latin(fname):
    with open(fname) as f:
        dst_dict = dict()
        for idx, f in enumerate(f.readlines()):
            tokens = list(filter(lambda x: x != '', re.split(r'[^\w]+', f)))
            book, chap, verse = [int(int(tokens[0]) / 10**(3*i)) % 1000 for i in range(2, -1, -1)]
            __ensure_verse(dst_dict, book, chap, verse)
            dst_dict[book][chap][verse] = " ".join(tokens[1:])
            # for idx, word in enumerate(tokens[1:]):
                # dst_dict[book][chap][verse].update({idx: word})
        return dst_dict
    
def _open_stub(fname):
    return dict()

def open_dst(language, fname, stdout_print=True):
    if (func := dict({
        "latin": _open_latin,
        "coptic": _open_stub,
        "armenian": _open_stub,
        "ethiopic": _open_stub,
        "georgian": _open_stub,
        "slavonic": _open_stub,
        "syriac": _open_stub,
        "arabic": _open_stub
    }).get(language.lower())) is None:
        func = _open_stub

    if stdout_print:
        print(f"Opening {fname}")
    return func(fname)

### Greek functions

# KJV/TR
def _open_kjtr(fname):
    with open("KJTR.txt", encoding='utf-8') as f:
        dst_dict = dict()
        for idx, f in enumerate(f.readlines()):
            tokens = list(filter(lambda x: x != '', re.split(r'[^\w]+', normalize_string(f))))
            book, chap, verse = [int(int(tokens[0]) / 10**(3*i)) % 1000 for i in range(2, -1, -1)]
            __ensure_verse(dst_dict, book, chap, verse)
            for idx, word in enumerate(tokens[1:]):
                dst_dict[book][chap][verse].update({idx: word})
        return dst_dict

# CNTR Collation (authoritative ID list)
def _open_collation(fname, normalize=True):
    with open(fname, encoding='utf-8') as f:
        greek_dict = dict()
        for fff in f.readlines()[1:]:
            id, variant, word = fff.split(',', 3)
            book, chap, verse, word_id = [int(int(id) / 10**(3*i)) % 1000 for i in range(3, -1, -1)]
            __ensure_verse(greek_dict, book, chap, verse)
            greek_dict[book][chap][verse].update({word_id: (normalize_string(word) if normalize else word, variant == 'V')})
        return greek_dict
    
# Picks the TR as the intelligible text, while still retaining matching word IDs from the authoritative source
def _align_tr_to_collation():
    collation = _open_collation()
    kjtr = _open_kjtr()
    # for 
    # TODO
    # Because the Collation will contain everything in TR plus more, we can just pop words out of collation if they don't match the corresponding word as we walk each list. Make sure to account for icu text normalization and everything during the pairing, but don't actually apply it to the final text

# Greek function picker
def open_greek(fname, stdout_print=True, normalize=False):
    if stdout_print:
        print(f"Opening {fname} (normalization={normalize})")
    return _open_collation(fname, normalize)

### NOTE: ERRATA
"""
Matthew 17:25: αυτω,ν



for book, book_contents in c.items():
...     for chap, chap_contents in book_contents.items():
...         for verse, verse_contents in chap_contents.items():
...             cv = list(verse_contents.items())
...             _ck = [x[0] for x in cv]
...             _cv = [x[1] for x in cv]
...             ccv = normalize_string(" ".join(_cv)).split(" ")
...             kv = normalize_string(" ".join(list(d[book][chap][verse].values()))).split(" ")
...
...             z=myers.diff(_cv, kv)
...             s="".join([x[0] for x in z])
...
...             mdict = dict()
...             sidx = 0
...             si_idxx = dict()
...             inc_sz_mem = 1
...             higher_mlen = False
...             # Equivalent number of Rs and Is
...             reg = re.finditer(r'(?P<group>r(?&group)?i)', s, overlapped=True)
...             offset = 0
...             #print([(m.start(), len(m.group())) for m in reg])
...             for idx, m in enumerate(reg):
...                 mlen = len(m.group())
...                 start = m.start()
...                 print(start, mlen, idx)
...                 if mlen != 2 and not higher_mlen:
...                     higher_mlen = True
...                     inc_sz_mem = round(mlen/2)
...                 si_idxx.update({start-offset: (start, inc_sz_mem)})
...                 if higher_mlen and mlen == 2:
...                     offset += inc_sz_mem
...                     inc_sz_mem = 1
...                     higher_mlen = False
                 
                if not higher_mlen:
...                     offset += 1
...
...             print(si_idxx)
...
...             ncv = dict()
...             kvidx = 0
...             for idx, xw in enumerate(zip(cv, ccv)):
...                 cvx, ccvw = xw
...                 cvk, cvw = cvx
...                 idxx = si_idxx.get(idx)
...                 if kvidx < len(kv) and (cvw == kv[kvidx] or idxx is not None):
...                     if idxx is not None:
...                         print(idxx, cvw)
...                         loc, inc_sz = idxx
...                         w = z[loc+inc_sz][1]
...                     else:
...                         w = ccvw
...                     ncv.update({cvk: w})
...                     kvidx += 1
...             _ncv = list(ncv.values())
...             print(f"{book}-{chap}-{verse}\n{myers.diff(_cv, kv)}\n{' '.join(_cv)}\n{' '.join(kv)}\n{' '.join(_ncv)}", end='\n\n')
...             print(f"{book}-{chap}-{verse}\n{_ck}\n{list(ncv.keys())}", end='\n\n')
...             if " ".join(kv) != " ".join(_ncv):
...                 raise Exception()

"""
