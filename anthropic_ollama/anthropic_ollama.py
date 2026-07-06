from time import time
from os import mkdir
import anthropic

# Local imports
from greek_association import greek_association
from fileio import open_greek, open_dst, normalize_string, sub_chunk


# Enable printing
DEBUG = True
def _print(*args, **kwargs):
    if DEBUG:
        print(*args, sep=kwargs.pop("sep", ""), end=kwargs.pop("end", "\n"))


# Prompt preparation
MODEL_NAME = 'gemma4:31b-cloud'
client = anthropic.Anthropic(base_url="http://localhost:11434", api_key='ollama')
word_prompt = f"""From the Greek below, what does the {{}} word '{{}}' at position {{}} in the string "{{}}" best pair with? Use Google Translate to determine the most accurate result. If there is no match, return "None", otherwise provide the resulting word and no additional explanation
{{}}"""


# Destination language
language = "Latin"


# FILE IO
greek_fname = '../base_files/greek.csv'
dst_fname = '../base_files/StuttgartNT_corrected.txt'

now = f"anthropic_ollama_output_{str(round(time()))}"

mkdir(now)
fbase = f"{MODEL_NAME.replace(':', '-')}_{language}"
fout = f"{now}/{fbase}_output.txt"
ferr = f"{now}/{fbase}_errlog.txt"
open(fout, 'w')
open(ferr, 'w')

greek_dict = open_greek(greek_fname, stdout_print=DEBUG, normalize=True)
dst_dict = open_dst(language, dst_fname, stdout_print=DEBUG)

# MAIN
_print("Beginning Analysis")

for book_k, book_v in sub_chunk(greek_dict):
    for chap_k, chap_v in sub_chunk(book_v):
        for v_k, v_v in sub_chunk(chap_v):
            v_id = book_k * 10**6 + chap_k * 10**3 + v_k

            src_v_v = " ".join([vv[0] for vv in v_v.values()])
            
            try:
                dst_v_v = dst_dict[book_k][chap_k][v_k]
            except Exception as e:
                dst_v_v = ""
                # continue

            # Pair Greek with destination language
            ga = greek_association(v_id, src_v_v, dst_v_v)
            
            # Loop over each word in the verse in the destination langugage and match it to a Greek word/phrase
            _print(v_id, src_v_v, dst_v_v, sep='\n')
            for idx, word in enumerate(ga.dst_list):

                request = word_prompt.format(language, word, idx, dst_v_v, src_v_v)

                response = client.messages.create(
                    max_tokens=len(src_v_v)+len(dst_v_v), model=MODEL_NAME,
                    messages=[
                        {'role': 'user', 'content': request}
                    ]
                )

                res = normalize_string(response.content[0].text)

                ### NOTE: We are feeding words from the destination text one-at-a-time
                ### There are 4 categories that responses could fall into:
                # 1. Single Latin --> no Greek equivalent. Return "None" (this is a string literal, not the Python object of type(NoneType))
                # 2. Single Latin --> Single Greek. Easy 1-to-1 pairing (with munching logic and hallucination checks)
                # 3. Single Latin --> Multiple Greek. This requires additional logic (on top of hallucination checks and munching logic) due to whether or not the Greek words  
                # 4. Single Latin --> Part of several Latin words that should be associated with a single Greek word. It is possible that not all Latin words from the Greek group will get associated.
                greek_word_id = ga.associate(res, idx)

                # TODO: we need to track if maybe there needs to be a human to check things
                # TODO: create manual CLI checker/associator
            
            _print()
            buff = ga.print_association(stdout_print=DEBUG)
            with open(fout, 'a') as f:
                f.write(buff)

            # except Exception as e:
            #     with open(ferr, 'a') as f:
            #         f.write(str(e) + "\n")
