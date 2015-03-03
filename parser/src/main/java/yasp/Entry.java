package yasp;

public class Entry {
    public Integer time;
    public String type;
    public String unit;
    public String key;
    public Integer value;
    public Integer slot;
    public String subtype;
    public String attacker;
    public String target;
    public String inflictor;
    public Integer gold_reason;
    public Integer xp_reason;
    public Entry(){
    }
    public Entry(Integer time){
        this.time = time;
    }
    public Entry(CombatLogEntry cle){
        this.time = Math.round(cle.getTimestamp());
    }
}
