import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.jetbrains.kotlin.gradle.tasks.KotlinCompile

plugins {
    alias(libs.plugins.spring.boot)
    alias(libs.plugins.spring.dependency.management)
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.jpa)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kotlin.allopen)
}

group = "com.example.supply.services"
version = "1.0.0-SNAPSHOT"

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

tasks.withType<KotlinCompile> {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
        freeCompilerArgs.addAll("-Xjsr305=strict")
    }
    // Enable caching for Kotlin compilation outputs
    outputs.cacheIf { true }
}

dependencies {
    implementation(project(":app:common"))
    implementation(project(":app:supply:m1-data"))

    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.validation)
    implementation(libs.spring.boot.starter.webflux)
    implementation(libs.spring.boot.starter.data.redis)
    implementation(libs.postgresql)

    implementation(libs.bundles.kotlin.core)
    implementation(libs.bundles.kotlin.coroutines)

    implementation(libs.hypersistence.utils)

    implementation(libs.commons.lang3)
    implementation(libs.commons.csv)
    implementation(libs.commons.pool2)
    implementation(libs.opencsv)
    implementation(libs.commons.beanutils) // Force version 1.11.0 to fix CVE
    implementation(libs.jsch)

    testImplementation(libs.spring.boot.starter.test)
    testImplementation(libs.mockk)
    testImplementation(libs.springmockk)
    testImplementation(libs.kotlin.test.junit5)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.assertj.core)
    testImplementation(libs.reactor.test)
}

allOpen {
    annotation("jakarta.persistence.Entity")
    annotation("org.springframework.stereotype.Component")
    annotation("org.springframework.stereotype.Service")
    annotation("org.springframework.stereotype.Repository")
}

tasks.jar {
    enabled = true
    archiveBaseName.set("supply-services")
    archiveClassifier.set("")
}

tasks.bootJar {
    enabled = false
}
