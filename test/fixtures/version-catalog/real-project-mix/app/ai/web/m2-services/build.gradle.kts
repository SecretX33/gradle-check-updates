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

group = "com.example.service"
version = "1.0.0-SNAPSHOT"

java {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
}

dependencies {
    api(project(":app:web:m2-core"))
    implementation(project(":app:ai:m1-data"))
    implementation(project(":app:ai:m5-api"))
    implementation(project(":app:ai:m2-services"))
    implementation(project(":app:supply:m5-api"))
    implementation(project(":app:content:m5-api"))
    implementation(project(":app:content:m1-data"))
    implementation(project(":app:content:m2-services"))

    // Spring Boot
    implementation(libs.spring.boot.starter.data.jpa)
    implementation(libs.spring.boot.starter.data.redis)
    implementation(libs.spring.boot.starter.web)
    implementation(libs.spring.boot.starter.validation)
    implementation(libs.spring.boot.starter.webflux)
    implementation(libs.spring.boot.starter.actuator)
    implementation(libs.auth0.spring.security)

    // JWT
    implementation(libs.bundles.jwt)

    // Kotlin libs
    implementation(libs.bundles.kotlin.core)
    implementation(libs.bundles.kotlin.coroutines)

    // serializable
    implementation(libs.hypersistence.utils)

    implementation(libs.commons.lang3)
    implementation(libs.commons.csv)

    // Google maps
    implementation(libs.bundles.google.maps)
    implementation(libs.libphonenumber)

    implementation(libs.jsoup)
    implementation(libs.commons.codec)

    implementation(libs.telnyx)
    implementation(libs.bouncycastle)
    implementation(libs.geoip2)

    testImplementation(kotlin("test"))

    // Test dependencies
    testRuntimeOnly(libs.h2)
    testImplementation(testFixtures(project(":app:web:m1-data")))
    testImplementation(libs.springmockk)
    testImplementation(libs.spring.boot.starter.test)
    testImplementation(libs.mockk)
    testImplementation(libs.kotlin.test.junit5)
    testImplementation(libs.assertj.core)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.reactor.test)
    testImplementation(libs.bucket4j)
    testImplementation(libs.mockito.core)

    // Testcontainers for concurrency integration tests against real PostgreSQL
    testImplementation(libs.testcontainers.junit.jupiter)
    testImplementation(libs.testcontainers.postgresql)

    // OSV test dependencies
    testImplementation(libs.xmlunit.core)
}

allOpen {
    annotation("jakarta.persistence.Entity")
    annotation("org.springframework.stereotype.Component")
    annotation("org.springframework.stereotype.Service")
    annotation("org.springframework.stereotype.Repository")
}

tasks.jar {
    enabled = true
    archiveBaseName.set("web-services")
    archiveClassifier.set("")
}

tasks.bootJar {
    enabled = false
}

tasks.withType<KotlinCompile>().configureEach {
    compilerOptions {
        jvmTarget.set(JvmTarget.JVM_21)
    }
    outputs.cacheIf { true }
}
