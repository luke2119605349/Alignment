class greek_association():
    
    # Create structure
    def __init__(self, v_id: int, src_v: str, dst_v: str):
        # Lowercase everything
        self.v_id = v_id*1000
        self.greek_flat = src_v.lower()
        self.greek_list = self.greek_flat.split(' ')
        self.greek = dict({self.v_id + i: (w, []) for i, w in enumerate(self.greek_list)})
        
        self.dst_flat = dst_v.lower()
        self.dst_list = self.dst_flat.split(' ')
        self.dst = [(w, []) for w in self.dst_list]

    def associate(self, greek, dst_idx):
        glist = greek.split(" ")
        
        """
        We can pair if:
            1) The Greek word/s are present in sequential order in the original verse (this weeds out hallucinations and "None")
            AND
            2)
              a) The Greek words have nothing paired with them currently
            OR
              b) The Greek words are paired with the previous destination language word. This would indicate that multiple destination lanuage words are associated with a single Greek word.
              BUT NOT
              if self.greek_flat[idx-1] == self.greek_flat[idx]
        """
        for i in range(len(self.greek_list) - len(glist) + 1):
            sublist_in_list = glist == self.greek_list[i:i+len(glist)]
            if not sublist_in_list:
                continue

            unused = all([self.greek.get(self.v_id + i + j)[1] == [] for j in range(len(glist))])
            
            _greek_dup_dst_single = all([self.dst[dst_idx-1][0] in self.greek.get(self.v_id + i + j)[1] and dst_idx > 0 for j in range(len(glist))])
            
            _greek_dup_dst_dup = len(glist) == 1 and i < len(self.greek_list) - 1 and self.greek.get(self.v_id + i + 1)[0] == glist[0]
            
            unmunched = unused or (_greek_dup_dst_single and not _greek_dup_dst_dup)
            if not unmunched:
                continue

            w_id = self.v_id + i
            for widx, w in enumerate(glist):
                self.greek.get(w_id+widx)[1].append(self.dst_list[dst_idx])
            self.dst[dst_idx][1].extend([wi for wi in range(w_id, w_id + len(glist))])
            
            return w_id
        return None

    # To be called after running self.associate(). Returns what will be written to a file
    def print_association(self, stdout_print=True):
        s = f"{int(self.v_id/1000)}\n"

        for i in range(len(self.dst)):
            w = self.dst[i]
            dst_w, greek_ids = w
            
            # Ad hoc way to eliminate unnecessary overlap sometimes
            # if (len(greek_ids) == 2) and (i+1 < len(self.dst)) and (greek_ids[1] == self.dst[i+i][1][0]):
                # greek_ids = [greek_ids[0]]

            # NOTE: The ID+1 is important
            greek_portion = " ".join([f"{id+1} {self.greek.get(id)[0]}" for id in greek_ids])
            line = f"{dst_w} - {greek_portion}\n"
            s += line

        if stdout_print:
            print(s)

        return s
