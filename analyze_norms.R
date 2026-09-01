## Generates data/brain-norms.js: percentile positions for my FreeSurfer measures
## against the lifespan brain-charts normative models (Bethlehem et al. 2022, Nature).
##
## Usage (Docker, matching the run that produced the committed data file):
##   docker build -t fs-norms-r - <<'EOF'
##   FROM rocker/r-base:4.4.1
##   RUN Rscript -e "install.packages(c('gamlss','jsonlite'), repos='https://cloud.r-project.org')"
##   EOF
##   git clone https://github.com/brainchart/lifespan $HOME/lifespan
##   docker run --rm -v $HOME:/repo fs-norms-r Rscript /repo/brain/analyze_norms.R
## (the script expects the lifespan repo at /repo/lifespan and writes /repo/brain-norms.js;
##  user values below are from the FreeSurfer 6.0 reprocessing of the scan
##  (subject brain-fs6) to match the models' reference pipeline — update to re-run)

REPO <- "/repo/lifespan"; setwd(REPO)
for (f in c("100.common-variables.r","101.common-functions.r","102.gamlss-recode.r",
            "300.variables.r","301.functions.r"))
  suppressWarnings(suppressMessages(source(file.path(REPO, f))))

library(jsonlite)

## ---- user values ----
## The reference models were fitted on FreeSurfer 6.0-era segmentations, so the
## values fed to the models come from an FS 6.0 reprocessing of the same scan
## (subject brain-fs6) — compare_norms.py documents the measured version effects.
## Descriptive charts on the page still use the full FS 8.2.0 stats.
USER <- list(
  ## FS6's Talairach-derived eTIV is broken here (1.08 L, below its own BrainSeg
  ## volume — BrainSegVol-to-eTIV = 1.14 must be < 1); keep the FS8 value.
  eTIV       = 1681088.9,
  GMV        = 490636.3,    ## CortexVol
  WMV        = 499171.2,    ## CerebralWhiteMatterVol
  sGMV       = (7630.9+8093.0)+(3767.1+3730.1)+(5131.2+5140.2)+(1926.1+1834.4)+
               (4029.3+4581.9)+(1984.4+1814.7)+(531.9+661.1)+(4308.5+4278.6),
  Ventricles = 18947.0,
  TCV        = 490636.3 + 499171.2,   ## GMV+WMV (cerebrum total cortical volume)
  meanCT     = (2.49094+2.40232)/2,  ## mean of lh/rh MeanThickness (mm)
  totalSA    = 91638.9 + 91637.0,
  ## subcortical L+R totals, mm3
  Thalamus.Proper  = 7630.9+8093.0,
  Caudate          = 3767.1+3730.1,
  Putamen          = 5131.2+5140.2,
  Pallidum         = 1926.1+1834.4,
  Hippocampus      = 4029.3+4581.9,
  Amygdala         = 1984.4+1814.7,
  Accumbens.area   = 531.9+661.1,
  VentralDC        = 4308.5+4278.6
)


## ---- helpers ----
## The scan was acquired at age 41 (DICOM PatientAge), so the population
## reference is evaluated there, and the charts' "you" marker sits at x = 41.
AGE_DAYS <- 365 * 41
newgrid <- function(extra = list()) {
  g <- do.call(expand.grid, c(list(AgeTransformed = log(AGE_DAYS),
                                   sex = factor("Male", levels = c("Female","Male"))), extra))
  g
}

## percentile of user's value vs. population (no study ranef, fs_version at grand mean)
pct.of <- function(fitfile, value) {
  FIT <- readRDS(file.path(REPO, "Share", "RefittedModels", fitfile))
  cov <- attr(FIT$param, "model")$covariates
  Y <- cov$Y
  G <- newgrid()
  G[[Y]] <- value
  R <- Apply.Param(NEWData = G, FITParam = FIT$param, Add.Normalise = TRUE,
                   Add.Derivative = FALSE)
  ## the centile column is named after the response column, which some fits
  ## store as "<Y>" and others as "<Y>Transformed"
  qcol <- sprintf("%s.q.pop", Y)
  if (is.null(R[[qcol]])) qcol <- sprintf("%sTransformed.q.pop", Y)
  list(median  = R[[sprintf("PRED.m500.pop")]][1],
       pct     = R[[qcol]][1],
       params  = list(mu = R[["mu.pop"]][1], sigma = R[["sigma.pop"]][1]))
}

curves.of <- function(fitfile, ages = seq(20, 80, by = 1)) {
  FIT <- readRDS(file.path(REPO, "Share", "RefittedModels", fitfile))
  G <- do.call(expand.grid, list(AgeTransformed = log(365 * ages),
                                 sex = factor("Male", levels = c("Female","Male"))))
  R <- Apply.Param(NEWData = G, FITParam = FIT$param, Add.Derivative = FALSE)
  list(ages = ages,
       lo   = R$PRED.l025.pop, lin = R$PRED.l250.pop, med = R$PRED.m500.pop,
       hiin = R$PRED.u750.pop, hi  = R$PRED.u975.pop)
}

OUT <- list(meta = list(age = 41, sex = "male", family = "GGalt",
             source = "Bethlehem et al. 2022 Nature brain-charts (FS-harmonized to FS6)"),
       composition = list(), global = list(), subcortical = list())

CONV <- function(mm3) mm3 / 1e4   ## mm3 -> model unit (1e-2 L); cm3 = model*10

## ---- composition panels (curves scaled to cm3 = model*10) ----
for (n in c("GMV","WMV","sGMV","Ventricles")) {
  f <- sprintf("FIT_%s.rds", n)
  cv <- curves.of(f)
  cv$lo <- round(cv$lo * 10, 2); cv$lin <- round(cv$lin * 10, 2)
  cv$med <- round(cv$med * 10, 2); cv$hiin <- round(cv$hiin * 10, 2)
  cv$hi <- round(cv$hi * 10, 2)
  p  <- pct.of(f, CONV(USER[[n]]))
  OUT$composition[[n]] <- c(list(user = round(USER[[n]]/1000, 1),
                                 pct = p$pct * 100),
                            cv,
                            median = round(p$median * 10, 1))
  cat(n, " pct:", round(p$pct*100,1), " median_cm3:", round(p$median*10,1),
      " mu:", p$params$mu, "\n")
}

## ---- globals (percentile only) ----
GLOBAL_FILES <- list(eTIV="FIT_eTIVTransformed.gz", TCV="FIT_TCV.rds",
                     meanCT="FIT_meanCT2.rds", totalSA="FIT_totalSA2.rds")
for (key in names(GLOBAL_FILES)) {
  f <- GLOBAL_FILES[[key]]
  val <- if (key == "meanCT") USER$meanCT else if (key == "totalSA") USER$totalSA else USER[[key]]
  v <- val / 10000
  p <- pct.of(f, v)
  OUT$global[[key]] <- list(user = if (grepl("meanCT|totalSA", key)) round(val,2) else round(USER[[key]]/1000, 1),
                            pct = p$pct * 100, median = p$median, param = p$params)
  cat(key, " pct:", round(p$pct*100,1), " median:", p$median, "\n")
}

## ---- subcortical: models are per-hemisphere (each side an observation),
## so percentiles are computed per side against the single-side distribution ----
SIDES <- list(
  list(fs = "Thalamus.Proper",  key = "Thalamus",      lh = 7630.9, rh = 8093.0),
  list(fs = "Caudate",          key = "Caudate",       lh = 3767.1, rh = 3730.1),
  list(fs = "Putamen",          key = "Putamen",       lh = 5131.2, rh = 5140.2),
  list(fs = "Pallidum",         key = "Pallidum",      lh = 1926.1, rh = 1834.4),
  list(fs = "Hippocampus",      key = "Hippocampus",   lh = 4029.3, rh = 4581.9),
  list(fs = "Amygdala",         key = "Amygdala",      lh = 1984.4, rh = 1814.7),
  list(fs = "Accumbens.area",   key = "Accumbens area",lh = 531.9,  rh = 661.1),
  list(fs = "VentralDC",        key = "VentralDC",     lh = 4308.5, rh = 4278.6)
)
for (s in SIDES) {
  f <- sprintf("FIT_%sTransformed.gz", s$fs)
  pl <- tryCatch(pct.of(f, s$lh / 10000), error = function(e) { cat(s$key, "L ERR:", conditionMessage(e), "\n"); NULL })
  pr <- tryCatch(pct.of(f, s$rh / 10000), error = function(e) { cat(s$key, "R ERR:", conditionMessage(e), "\n"); NULL })
  if (!is.null(pl) && !is.null(pr)) {
    cv <- curves.of(f)
    cv$lo   <- round(cv$lo   * 10, 2)  # model unit -> cm3
    cv$lin  <- round(cv$lin  * 10, 2)
    cv$med  <- round(cv$med  * 10, 2)
    cv$hiin <- round(cv$hiin * 10, 2)
    cv$hi   <- round(cv$hi   * 10, 2)
    OUT$subcortical[[s$key]] <- c(list(
      l = list(user = round(s$lh/1000, 2), pct = pl$pct * 100),
      r = list(user = round(s$rh/1000, 2), pct = pr$pct * 100),
      median = round(pl$median * 10, 2)),  # per-hemisphere median, cm3
      cv)
    cat(s$key, " L:", round(pl$pct*100,1), " R:", round(pr$pct*100,1),
        " median_side_cm3:", round(pl$median*10,2), "\n")
  }
}

## ---- cortex: per-region mean thickness (Desikan atlas, 34 regions).
## models may be in raw mm or model-unit mm/1e4 — detect the scale from the
## population median (must land in 1.2–4 mm either way) ----
CORTEX_VALS <- list(   ## lh, rh ThickAvg (mm) from lh/rh.aparc.stats
                       ## of the FS 6.0 reprocessing (subject brain-fs6)
  bankssts                = c(2.390, 2.554),
  caudalanteriorcingulate = c(2.794, 2.488),
  caudalmiddlefrontal     = c(2.483, 2.423),
  cuneus                  = c(1.903, 1.905),
  entorhinal              = c(3.150, 3.283),
  fusiform                = c(2.744, 2.746),
  inferiorparietal        = c(2.402, 2.425),
  inferiortemporal        = c(2.774, 2.772),
  isthmuscingulate        = c(2.306, 2.219),
  lateraloccipital        = c(2.222, 2.279),
  lateralorbitofrontal    = c(2.586, 2.200),
  lingual                 = c(2.001, 1.993),
  medialorbitofrontal     = c(2.409, 2.297),
  middletemporal          = c(2.936, 2.818),
  parahippocampal         = c(2.742, 2.600),
  paracentral             = c(2.337, 2.404),
  parsopercularis         = c(2.749, 2.541),
  parsorbitalis           = c(2.683, 2.482),
  parstriangularis        = c(2.575, 2.347),
  pericalcarine           = c(1.603, 1.652),
  postcentral             = c(2.155, 2.029),
  posteriorcingulate      = c(2.547, 2.523),
  precentral              = c(2.609, 2.479),
  precuneus               = c(2.403, 2.345),
  rostralanteriorcingulate= c(3.011, 2.671),
  rostralmiddlefrontal    = c(2.405, 2.147),
  superiorfrontal         = c(2.651, 2.506),
  superiorparietal        = c(2.143, 2.079),
  superiortemporal        = c(2.938, 2.853),
  supramarginal           = c(2.369, 2.403),
  frontalpole             = c(2.550, 1.889),
  temporalpole            = c(3.258, 3.174),
  transversetemporal      = c(2.425, 2.575),
  insula                  = c(2.909, 3.044)
)
for (key in names(CORTEX_VALS)) {
  f <- sprintf("FIT_CT_%s.rds", key)
  res <- tryCatch({
    cv <- curves.of(f)
    med0 <- cv$med[1]
    scale <- if (med0 * 10000 > 1.2 && med0 * 10000 < 4) 10000 else 1
    ## keep only the population band at the scan's age (iage = index in seq(20,80))
    iage <- OUT$meta$age - 20 + 1
    pl <- pct.of(f, CORTEX_VALS[[key]][1] / scale)
    pr <- pct.of(f, CORTEX_VALS[[key]][2] / scale)
    list(l  = list(user = CORTEX_VALS[[key]][1], pct = pl$pct * 100),
         r  = list(user = CORTEX_VALS[[key]][2], pct = pr$pct * 100),
         median = round(pl$median * scale, 3),
         lo   = round(cv$lo[iage]   * scale, 3),
         lin  = round(cv$lin[iage]  * scale, 3),
         hiin = round(cv$hiin[iage] * scale, 3),
         hi   = round(cv$hi[iage]   * scale, 3))
  }, error = function(e) { cat(key, "ERR:", conditionMessage(e), "\n"); NULL })
  if (!is.null(res)) {
    OUT$cortex[[key]] <- res
    cat(key, " L:", round(res[["l"]][["pct"]], 1), " R:", round(res[["r"]][["pct"]], 1),
        " median_mm:", res$median, "\n")
  }
}

write_lines <- function(x, path) cat(x, "\n", file = path, sep = "")
js <- capture.output(cat("window.BRAIN_NORMS = ", toJSON(OUT, auto_unbox = TRUE, digits = 6), ";", sep = ""))
writeLines(js, "/repo/brain-norms.js")
cat("WROTE /repo/brain-norms.js\n")