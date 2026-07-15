%% ========================================================================
%  CM AUTOPILOT  —  VAC HEALTH ENGINE  (MATLAB reference implementation)
%  ------------------------------------------------------------------------
%  This is the rigorous, offline twin of the in-browser VAC engine. The web
%  app (src/lib/vacHealth.js) runs the same physics so the end user never needs
%  MATLAB; this script exists to VALIDATE that model, to produce the
%  publication-quality diagnostic figure, and to write the spreadsheet row.
%
%  Same health index, same weighting, same thresholds as the browser. If the
%  two ever disagree on a log, that is a bug — they are meant to match.
%
%  THE THESIS
%  The current process counts LPT-low / HPT-high threshold crossings. That only
%  sees faults that already fired. On the reference log (T5125, Car A) the SCU
%  raised LPT1_LOW ONCE in 4,930 samples, so the spreadsheet calls it healthy.
%  The physics says otherwise:
%      cooling dT ......... 6.7 C  (healthy 8-12 C)
%      not cooling ........ 36.5% of running time
%      compression ratio .. 3.2    (healthy 3.5-4.5)
%  Low ratio + weak dT is the undercharge signature. Score: 66/100, WATCH.
%
%  NOTE ON SHORT CYCLING: this SCU log is EVENT-BASED (~10 min between rows),
%  not periodic. Run-length "short cycling" on sparse timestamps is a weak
%  signal, so it is DISPLAYED but given low weight in the score. Do not oversell
%  it in a room - the timestamps cannot support a hard claim.
%
%  Base MATLAB only. No toolboxes.
%
%  USAGE
%      >> vac_health                          % file picker
%      >> vac_health('T5125_car_A_vac_1.xls')
%% ========================================================================

function vac_health(logfile)

%% ---- CONFIG : edit thresholds here and nowhere else --------------------
CFG.LP_LOW_BAR      = 1.60;   CFG.HP_HIGH_BAR   = 24.0;  CFG.HPS_LOCKOUT_BAR = 27.0;
CFG.DT_HEALTHY_MIN  = 8.0;    CFG.DT_HEALTHY_MAX = 12.0; CFG.DT_FAILED       = 5.0;
CFG.PR_HEALTHY_MIN  = 3.5;    CFG.PR_HEALTHY_MAX = 4.5;
CFG.SHORT_CYCLE_MIN = 3.0;    CFG.DUTY_WARN_PCT  = 60;
%% -----------------------------------------------------------------------

if nargin < 1 || isempty(logfile)
    [f,p] = uigetfile({'*.xls;*.csv;*.txt','VAC SCU log'}, 'Select a VAC SCU log');
    if isequal(f,0), fprintf('Cancelled.\n'); return; end
    logfile = fullfile(p,f);
end

fprintf('\n========================================================================\n');
fprintf('  CM AUTOPILOT  |  VAC HEALTH ENGINE (MATLAB reference)\n');
fprintf('========================================================================\n');
fprintf('  Log : %s\n', logfile);

T = readSCULog(logfile);
fprintf('  Samples : %d   Period : %s -> %s\n', height(T), ...
        datestr(min(T.Time),'yyyy-mm-dd'), datestr(max(T.Time),'yyyy-mm-dd'));

[~, base] = fileparts(logfile);
tok = regexp(base, 'T?(5\d{3}).*?car[_ ]?([A-E]).*?vac[_ ]?(\d)', 'tokens', 'ignorecase');
if ~isempty(tok), ID.trainset=tok{1}{1}; ID.car=upper(tok{1}{2}); ID.vac=tok{1}{3};
else, ID.trainset='unknown'; ID.car='?'; ID.vac='?'; end
fprintf('  Unit : Trainset %s / Car %s / VAC %s\n', ID.trainset, ID.car, ID.vac);
fprintf('------------------------------------------------------------------------\n');

%% operating mask: regulating AND a compressor commanded on
inRegulation = contains(string(T.SubMode), 'REGULATION_NORMAL');
compCmd  = [T.DO_COMP1 T.DO_COMP2 T.DO_COMP3 T.DO_COMP4];
anyCompOn= any(compCmd == 1, 2);
M = inRegulation & anyCompOn;
fprintf('  Assessment window: %d samples\n', sum(M));

%% cooling effectiveness
dT_all = T.TEMPERATURE_RETURN_AIR - T.TEMPERATURE_SUPPLY_AIR;
dT = dT_all(M); dT = dT(~isnan(dT));
if isempty(dT), error('Unit never ran in REGULATION_NORMAL with a compressor on.'); end
R.dT_median = median(dT);
R.dT_failFrac = mean(dT < CFG.DT_FAILED);

%% compressors: duty, cycling, contactor
for k = 1:4
    cmd = T.(sprintf('DO_COMP%d',k)); fb = T.(sprintf('DI_COMP%d_FEEDBACK',k));
    runMins = runLengths(cmd, T.Time);
    C(k).duty = 100*mean(cmd(inRegulation)==1);
    C(k).nCycles = numel(runMins);
    C(k).medRunMin = median(runMins);
    C(k).shortCycles = sum(runMins < CFG.SHORT_CYCLE_MIN);
    onRows = (cmd==1);
    C(k).mismatch = sum(onRows & (fb==0));
    C(k).mismatchPct = 100*C(k).mismatch/max(sum(onRows),1);
end
R.shortCyclesTotal = sum([C.shortCycles]);
R.cyclesTotal = sum([C.nCycles]);
R.dutyMean = mean([C.duty]);

%% refrigerant circuits
for c = 1:2
    HP = T.(sprintf('HP%d_TRANSDUCER',c)); LP = T.(sprintf('LP%d_TRANSDUCER',c));
    hp = HP(M); lp = LP(M); ok = ~isnan(hp)&~isnan(lp)&lp>0.2;
    P(c).HP_med=median(hp(ok)); P(c).LP_med=median(lp(ok)); P(c).PR_med=median(hp(ok)./lp(ok));
    P(c).LP_lowCount = countCrossings(LP, CFG.LP_LOW_BAR, 'below');
    P(c).HP_highCount= countCrossings(HP, CFG.HP_HIGH_BAR, 'above');
end
R.PR_mean = mean([P.PR_med]);

%% condenser fouling
amb = T.TEMPERATURE_FRESH_AIR(M); hp1 = T.HP1_TRANSDUCER(M); ok = ~isnan(amb)&~isnan(hp1);
if sum(ok) > 20
    coef = polyfit(amb(ok), hp1(ok), 1);
    R.cond_slope=coef(1); R.cond_int=coef(2); R.HP_at45=polyval(coef,45);
else
    R.cond_slope=NaN; R.cond_int=NaN; R.HP_at45=NaN;
end

%% flags
flagNames = {'COOLING_NOT_EFFECTIVE','AC_FAULT','RAD_FAULT','SUPPLY_TOO_LOW', ...
             'LPT1_LOW','LPT2_LOW','HPT1_HIGH','HPT2_HIGH','HPS1_LOCKOUT','HPS2_LOCKOUT'};
for i=1:numel(flagNames)
    if ismember(flagNames{i}, T.Properties.VariableNames)
        F.(flagNames{i}) = 100*mean(T.(flagNames{i})==1);
    else, F.(flagNames{i}) = NaN; end
end

%% health index (identical to browser)
s_cool = 40*clamp((R.dT_median-CFG.DT_FAILED)/(CFG.DT_HEALTHY_MIN-CFG.DT_FAILED),0,1);
s_cool = s_cool*(1-0.5*R.dT_failFrac);
s_pr   = 20*clamp((R.PR_mean-2.5)/(CFG.PR_HEALTHY_MIN-2.5),0,1);
shortRate = R.shortCyclesTotal/max(R.cyclesTotal,1);
s_cyc  = 20*clamp(1 - max(0,shortRate-0.5)/0.4, 0, 1);   % low weight: event-based log
s_con  = 10*clamp(1 - max([C.mismatchPct])/5, 0, 1);
flagLoad = (F.COOLING_NOT_EFFECTIVE + F.AC_FAULT + F.SUPPLY_TOO_LOW)/100;
s_flag = 10*clamp(1 - flagLoad/0.20, 0, 1);
HEALTH = s_cool+s_pr+s_cyc+s_con+s_flag;
R.health = HEALTH; R.parts=[s_cool s_pr s_cyc s_con s_flag];

%% trend
Tm=T(M,:); Tm.dT=Tm.TEMPERATURE_RETURN_AIR-Tm.TEMPERATURE_SUPPLY_AIR;
wk=floor(days(Tm.Time-min(Tm.Time))/7); uw=unique(wk);
wdT=arrayfun(@(w) mean(Tm.dT(wk==w),'omitnan'), uw); good=~isnan(wdT);
R.trend_slope=NaN; R.days_to_fail=NaN;
if sum(good)>=3
    cf=polyfit(uw(good),wdT(good),1); R.trend_slope=cf(1);
    if cf(1)<-0.05, R.days_to_fail=max(0,((CFG.DT_FAILED-cf(2))/cf(1)-max(uw))*7); end
end

%% verdict + report
verdict='HEALTHY';
if HEALTH<50, verdict='DEGRADED - INTERVENE'; elseif HEALTH<70, verdict='WATCH - PLAN MAINTENANCE'; end

fprintf('\n========================================================================\n');
fprintf('  HEALTH INDEX : %5.1f / 100        %s\n', HEALTH, verdict);
fprintf('========================================================================\n');
fprintf('    cooling effectiveness  %5.1f / 40\n', s_cool);
fprintf('    refrigerant charge     %5.1f / 20\n', s_pr);
fprintf('    cycling behaviour      %5.1f / 20\n', s_cyc);
fprintf('    contactor integrity    %5.1f / 10\n', s_con);
fprintf('    SCU fault flags        %5.1f / 10\n\n', s_flag);
fprintf('  COOLING\n    dT %.2f C [healthy %g-%g] | not cooling %.1f%% of run time\n', ...
        R.dT_median, CFG.DT_HEALTHY_MIN, CFG.DT_HEALTHY_MAX, 100*R.dT_failFrac);
fprintf('  CIRCUITS\n');
for c=1:2
    fprintf('    C%d: LP %.2f | HP %.2f | ratio %.2f [healthy %g-%g] | LPlow %d HPhigh %d\n', ...
        c, P(c).LP_med, P(c).HP_med, P(c).PR_med, CFG.PR_HEALTHY_MIN, CFG.PR_HEALTHY_MAX, P(c).LP_lowCount, P(c).HP_highCount);
end
fprintf('  COMPRESSORS\n');
for k=1:4
    w=''; if C(k).mismatchPct>1, w='  <-- CONTACTOR FAULT'; end
    fprintf('    COMP%d: duty %.1f%% | %d cycles | median run %.1f min | short %d%s\n', ...
        k, C(k).duty, C(k).nCycles, C(k).medRunMin, C(k).shortCycles, w);
end
fprintf('  CONDENSER\n    HP = %.3f*ambient + %.2f | projected %.1f bar at 45C', R.cond_slope, R.cond_int, R.HP_at45);
if R.HP_at45>CFG.HP_HIGH_BAR, fprintf('  *** EXCEEDS HP ALARM ***'); end
fprintf('\n  TREND\n');
if ~isnan(R.trend_slope)
    fprintf('    cooling dT %+.2f C/week', R.trend_slope);
    if ~isnan(R.days_to_fail), fprintf('  *** ~%.0f days to stop cooling ***', R.days_to_fail); end
    fprintf('\n');
else, fprintf('    insufficient history to trend\n'); end
fprintf('  ---------------------------------------------------------------------\n  DIAGNOSIS\n');
diag = buildDiagnosis(R,P,C,F,CFG);
for i=1:numel(diag), fprintf('    - %s\n', diag{i}); end
fprintf('========================================================================\n\n');

plotDashboard(T,M,R,P,C,CFG,ID,HEALTH,verdict);
writeTemplateRow(ID,P,T);
fprintf('  Written: vac_template_row.csv  (paste into the VAC Logs sheet)\n\n');
end

%% ===================== HELPERS ==========================================
function T = readSCULog(f)
    fid=fopen(f,'r'); if fid<0, error('Cannot open %s',f); end
    fgetl(fid); hdr=strsplit(strtrim(fgetl(fid)),sprintf('\t')); fclose(fid);
    hdr=hdr(~cellfun(@isempty,hdr));
    names=matlab.lang.makeUniqueStrings(matlab.lang.makeValidName(hdr));
    opts=delimitedTextImportOptions('NumVariables',numel(names));
    opts.Delimiter='\t'; opts.DataLines=[3 Inf]; opts.VariableNames=names;
    opts.ExtraColumnsRule='ignore'; opts=setvartype(opts,'string');
    T=readtable(f,opts);
    T.Time=datetime(T.Time,'InputFormat','yyyy-MM-dd HH:mm:ss');
    T=T(~isnat(T.Time),:); T=sortrows(T,'Time');
    keepText={'Time','EventType','EventTrigger','EventDescr','Mode','SubMode','CarType'};
    for i=1:numel(T.Properties.VariableNames)
        v=T.Properties.VariableNames{i};
        if ~ismember(v,keepText), T.(v)=str2double(T.(v)); end
    end
end

function runMins = runLengths(cmd, t)
    cmd=cmd(:); cmd(isnan(cmd))=0;
    d=diff([0; cmd==1; 0]); starts=find(d==1); stops=find(d==-1)-1;
    stops(stops>numel(t))=numel(t); n=numel(starts); runMins=zeros(n,1);
    for i=1:n
        if stops(i)>=starts(i)&&stops(i)<=numel(t), runMins(i)=minutes(t(stops(i))-t(starts(i))); end
    end
    runMins=runMins(runMins>0); if isempty(runMins), runMins=NaN; end
end

function n = countCrossings(x, thr, dir)
    x=x(:); x=x(~isnan(x)); if isempty(x), n=0; return; end
    if strcmp(dir,'below'), b=x<thr; else, b=x>thr; end
    n=sum(diff([0;b])==1);
end

function y=clamp(x,lo,hi), y=min(max(x,lo),hi); end

function d = buildDiagnosis(R,P,C,F,CFG)
    d={}; lowPR=R.PR_mean<CFG.PR_HEALTHY_MIN; lowDT=R.dT_median<CFG.DT_HEALTHY_MIN;
    if lowPR&&lowDT
        d{end+1}=['UNDERCHARGED / LEAKING CIRCUIT. Low compression ratio together with weak ' ...
                  'cooling is the classic low-charge signature. Leak-test and weigh the charge ' ...
                  'before topping up.'];
    elseif lowDT&&~lowPR
        d{end+1}=['COOLING WEAK BUT COMPRESSION NORMAL. Suspect airside: blocked return-air ' ...
                  'filter, iced/fouled evaporator, or failed evaporator fan. Check filter first.'];
    end
    if R.shortCyclesTotal>10
        d{end+1}=sprintf(['Frequent compressor restarts (%d short runs). Consistent with low ' ...
                  'charge, but this log is event-sampled (~10 min) so treat cycle timing as ' ...
                  'indicative, not exact.'], R.shortCyclesTotal);
    end
    if ~isnan(R.HP_at45)&&R.HP_at45>CFG.HP_HIGH_BAR
        d{end+1}=sprintf(['CONDENSER FOULING RISK. Head pressure extrapolates to %.1f bar at ' ...
                  '45 C, above the %g bar alarm. Clean the condenser coil.'], R.HP_at45, CFG.HP_HIGH_BAR);
    end
    for k=1:4
        if C(k).mismatchPct>1
            d{end+1}=sprintf(['COMPRESSOR %d ELECTRICAL FAULT. Commanded ON but no feedback in ' ...
                      '%.1f%% of attempts - contactor/breaker/overload, NOT refrigeration.'], k, C(k).mismatchPct);
        end
    end
    if F.RAD_FAULT>5
        d{end+1}=sprintf('RETURN AIR DAMPER faulted %.1f%% of the log - check RAD actuator and feedback.', F.RAD_FAULT);
    end
    if isempty(d), d{end+1}='No degradation signature detected.'; end
    if R.health<70
        d{end+1}=['NOTE: the SCU raised almost no pressure alarms. The spreadsheet method ' ...
                  '(counting LPT-low crossings) would score this unit healthy. The physics does not.'];
    end
end

function plotDashboard(T,M,R,P,C,CFG,ID,HEALTH,verdict)
    figure('Name',sprintf('VAC Health - T%s Car %s VAC%s',ID.trainset,ID.car,ID.vac),'Color','w','Position',[60 60 1280 800]);
    subplot(3,2,1);
    dT=T.TEMPERATURE_RETURN_AIR-T.TEMPERATURE_SUPPLY_AIR;
    plot(T.Time(M),dT(M),'.','Color',[.75 .78 .82],'MarkerSize',4); hold on;
    if sum(M)>20, plot(T.Time(M),movmean(dT(M),40,'omitnan'),'LineWidth',2,'Color',[.10 .45 .82]); end
    yline(CFG.DT_HEALTHY_MIN,'--','healthy floor','Color',[0 .55 .2]); yline(CFG.DT_FAILED,'--','not cooling','Color',[.85 .15 .1]);
    title(sprintf('Cooling effectiveness (median %.1f C)',R.dT_median)); ylabel('\DeltaT [\circC]'); grid on; box off;
    subplot(3,2,2);
    plot(T.Time(M),T.HP1_TRANSDUCER(M),'.','Color',[.85 .33 .10],'MarkerSize',4); hold on;
    plot(T.Time(M),T.LP1_TRANSDUCER(M),'.','Color',[.10 .45 .82],'MarkerSize',4);
    yline(CFG.LP_LOW_BAR,'--','LP alarm'); yline(CFG.HP_HIGH_BAR,'--','HP alarm');
    title(sprintf('Circuit 1 pressures (ratio %.2f)',P(1).PR_med)); ylabel('bar'); legend({'HP','LP'},'Box','off'); grid on; box off;
    subplot(3,2,3);
    pr=T.HP1_TRANSDUCER(M)./T.LP1_TRANSDUCER(M); pr=pr(isfinite(pr)&pr>0&pr<15);
    if ~isempty(pr), histogram(pr,40,'FaceColor',[.45 .45 .55],'EdgeColor','none'); hold on;
        xline(CFG.PR_HEALTHY_MIN,'--','healthy','Color',[0 .55 .2]); xline(median(pr),'-','actual','Color',[.85 .15 .1]); end
    title('Compression ratio HP/LP'); xlabel('ratio'); grid on; box off;
    subplot(3,2,4);
    amb=T.TEMPERATURE_FRESH_AIR(M); hp=T.HP1_TRANSDUCER(M); ok=~isnan(amb)&~isnan(hp);
    scatter(amb(ok),hp(ok),6,[.6 .65 .7],'filled'); hold on;
    if ~isnan(R.cond_slope), xx=linspace(min(amb(ok)),46,50); plot(xx,polyval([R.cond_slope R.cond_int],xx),'LineWidth',2,'Color',[.85 .33 .10]);
        yline(CFG.HP_HIGH_BAR,'--','HP alarm'); xline(45,':','Dubai summer'); end
    title(sprintf('Condenser: HP vs ambient (slope %.3f)',R.cond_slope)); xlabel('ambient [\circC]'); ylabel('HP [bar]'); grid on; box off;
    subplot(3,2,5);
    allRuns=[]; for k=1:4, r=runLengths(T.(sprintf('DO_COMP%d',k)),T.Time); allRuns=[allRuns; r(:)]; end
    allRuns=allRuns(~isnan(allRuns)&allRuns<40);
    if ~isempty(allRuns), histogram(allRuns,0:1:40,'FaceColor',[.45 .45 .55],'EdgeColor','none'); hold on;
        xline(CFG.SHORT_CYCLE_MIN,'--','short cycle','Color',[.85 .15 .1]); end
    title(sprintf('Compressor run lengths (%d short)',R.shortCyclesTotal)); xlabel('minutes'); grid on; box off;
    subplot(3,2,6);
    b=bar(R.parts,'FaceColor','flat'); maxes=[40 20 20 10 10];
    for i=1:5, fr=R.parts(i)/maxes(i); b.CData(i,:)=[1-fr*0.85,0.25+fr*0.55,0.30]; end
    hold on; plot(1:5,maxes,'k_','MarkerSize',22,'LineWidth',1.2);
    set(gca,'XTickLabel',{'cooling','charge','cycling','contactor','flags'}); ylabel('points'); ylim([0 42]);
    title(sprintf('HEALTH %.0f / 100 - %s',HEALTH,verdict)); box off; grid on;
    sgtitle(sprintf('CM Autopilot | VAC Health | Trainset %s, Car %s, VAC %s',ID.trainset,ID.car,ID.vac),'FontWeight','bold');
end

function writeTemplateRow(ID,P,T)
    fid=fopen('vac_template_row.csv','w');
    fprintf(fid,'Date,Train no,CAR,VAC,LPT1,HPT1,LPT1 low Count,LPT2,HPT2,LPT2 Low count\n');
    fprintf(fid,'%s,T%s,%s,VAC%s,%.2f,%.2f,%d,%.2f,%.2f,%d\n', ...
        datestr(max(T.Time),'yyyy-mm-dd'),ID.trainset,ID.car,ID.vac, ...
        P(1).LP_med,P(1).HP_med,P(1).LP_lowCount,P(2).LP_med,P(2).HP_med,P(2).LP_lowCount);
    fclose(fid);
end
